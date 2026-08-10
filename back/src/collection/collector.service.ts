import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type {
  CodedMessage,
  JobHandle,
  MetricSeries,
  MetricSnapshotPublic,
  Page,
} from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SourcesService } from '../sources/sources.service';
import { CodedException } from '../common/coded-exception';
import { JOB_ONESHOT } from '../common/job-options';
import { foldTrend, unitOf } from '../dora/trend';
import { DashboardService } from '../dashboard/dashboard.service';
import { DoraService } from '../dora/dora.service';
import { SyncService, type SyncOptions } from '../ingest/sync.service';
import { ChangelogsService } from '../changelogs/changelogs.service';
import { VersionReadingsService } from '../version-rules/version-readings.service';
import { toPage, type PageWindow } from '../common/pagination';

interface HistoryQuery {
  metric?: string;
  from?: string;
  to?: string;
}

/**
 * What one collection did, and what it gave up on.
 *
 * The best-effort steps below are caught so a partial failure still snapshots
 * what is stored — but caught silently, the job that ran them completes green
 * while the source it was collecting has stopped moving. The warnings are what
 * the background-jobs page reads to tell the two apart.
 */
export interface CollectionOutcome {
  snapshots: MetricSnapshotPublic[];
  warnings: CodedMessage[];
}

@Injectable()
export class CollectorService {
  private readonly logger = new Logger(CollectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
    private readonly dora: DoraService,
    private readonly sync: SyncService,
    private readonly changelogs: ChangelogsService,
    private readonly versions: VersionReadingsService,
    private readonly sources: SourcesService,
    @InjectQueue('collection') private readonly queue: Queue,
  ) {}

  /** What a collection wrote, for the caller that has nowhere to put the rest. */
  async collectSource(sourceId: string, options: SyncOptions = {}): Promise<MetricSnapshotPublic[]> {
    return (await this.collect(sourceId, options)).snapshots;
  }

  /**
   * Queues a deep re-read of a source and hands back what to follow it by.
   *
   * The job id is derived from the source, which is what makes a second click
   * meet the first rather than double it: two deep runs on one source would
   * spend the budget twice to write the same rows, and would race each other on
   * the cursors while doing it. An in-flight one is refused rather than
   * silently dropped — a caller who asked for a year and got nothing has to be
   * told which of the two happened.
   *
   * A settled job is a result being kept for whoever started it, not a claim on
   * the source: asking again supersedes it.
   */
  async queueRefresh(sourceId: string, historyDays?: number): Promise<JobHandle> {
    // Fails here rather than inside a job nobody is watching, and covers the
    // depth write below — which needs the source to exist just as much.
    await this.sources.readSpec(sourceId);
    if (historyDays !== undefined) {
      await this.sources.setHistoryDays(sourceId, historyDays);
    }

    const id = refreshJobId(sourceId);
    const existing = await this.queue.getJob(id);
    if (existing) {
      const state = await existing.getState();
      if (!settled(state)) {
        throw new CodedException('errors.collect.refreshInFlight', HttpStatus.CONFLICT, {
          state,
        });
      }
      await existing.remove();
    }

    await this.queue.add('collect-source', { sourceId, force: true }, { ...JOB_ONESHOT, jobId: id });
    this.logger.log(`Deep re-read of ${sourceId} queued (${id}).`);
    return { queue: 'collection', id };
  }

  /**
   * Queues a replay of the metric history over the last `days` days.
   *
   * Queued like a re-read, and deduplicated the same way: it walks a window a
   * day at a time and must outlive the request that asked for it. Unlike a
   * re-read it calls no platform listing beyond the one gathering — what it
   * costs is computation and rows, not budget.
   */
  async queueRebuild(sourceId: string, days?: number): Promise<JobHandle> {
    await this.sources.readSpec(sourceId);

    const id = rebuildJobId(sourceId);
    const existing = await this.queue.getJob(id);
    if (existing) {
      const state = await existing.getState();
      if (!settled(state)) {
        throw new CodedException('errors.collect.rebuildInFlight', HttpStatus.CONFLICT, { state });
      }
      await existing.remove();
    }

    await this.queue.add('rebuild-metrics', { sourceId, days }, { ...JOB_ONESHOT, jobId: id });
    this.logger.log(`DORA history replay queued for ${sourceId} (${id}).`);
    return { queue: 'collection', id };
  }

  /**
   * Fetch a source's data and persist metric snapshots.
   *
   * A stored source is brought up to date first: the snapshot below reads the
   * store, so ingesting is part of collecting it rather than a schedule of its
   * own — two cadences could only ever disagree about what the numbers describe.
   * A failed ingestion still snapshots what is stored, which is a real reading
   * of a view that stopped moving, not a hole in the series. What it gave up on
   * comes back with it rather than staying in the logs — see CollectionOutcome.
   */
  async collect(sourceId: string, options: SyncOptions = {}): Promise<CollectionOutcome> {
    const warnings: CodedMessage[] = [];

    await this.sync.syncIfStored(sourceId, options).catch((e) => {
      this.logger.warn(`Ingestion failed for ${sourceId}: ${asMessage(e)}`);
      warnings.push({ code: 'errors.collect.ingest', params: { error: asMessage(e) } });
    });

    // Only on a deep re-read. What just changed is the past — a deeper store,
    // or the same one read again — and the readings taken over it no longer
    // describe it. A scheduled run has nothing to restate: it adds a day to a
    // history the run before it already agreed with, and replaying on every
    // cron tick would rewrite that history every few minutes for nothing.
    if (options.force) {
      const { historyDays } = await this.sources.readSpec(sourceId);
      await this.dora.rebuild(sourceId, historyDays ?? undefined).catch((e) => {
        this.logger.warn(`DORA history replay failed for ${sourceId}: ${asMessage(e)}`);
        warnings.push({ code: 'errors.collect.rebuild', params: { error: asMessage(e) } });
      });
    }

    const live = await this.dashboard.live(sourceId);
    const capturedAt = new Date();
    const points: Array<{ metric: string; value: number }> = [
      { metric: 'open_prs', value: live.summary.openPrs },
      { metric: 'stale_prs', value: live.summary.stalePrs },
      { metric: 'failed_pipelines', value: live.summary.failedPipelines },
      { metric: 'running_pipelines', value: live.summary.runningPipelines },
    ];
    const created = await this.prisma.$transaction(
      points.map((p) =>
        this.prisma.metricSnapshot.create({
          data: { sourceId, metric: p.metric, value: p.value, dimensions: {}, capturedAt },
        }),
      ),
    );

    // DORA collection is heavier (many API calls) and best-effort: a failure
    // here must not drop the summary snapshots above.
    await this.dora.snapshot(sourceId).catch((e) => {
      this.logger.warn(`DORA snapshot failed for ${sourceId}: ${asMessage(e)}`);
      warnings.push({ code: 'errors.collect.dora', params: { error: asMessage(e) } });
    });

    // Before the archiving rather than after it: reading a version is a request
    // to somebody else's application, and what it confirms is the deployment
    // that just went out. Left until last it would run behind a batch of
    // comparisons, and confirm it a good deal later than it could have.
    await this.versions.probeSource(sourceId).catch((e) => {
      this.logger.warn(`Version probing failed for ${sourceId}: ${asMessage(e)}`);
      warnings.push({ code: 'errors.collect.versions', params: { error: asMessage(e) } });
    });

    // Last, and best-effort like the rest — but the only step here whose work
    // cannot be made up later: a deployment nobody filed before its environment
    // was torn down is a changelog no future run can produce.
    const archive = await this.changelogs.archive(sourceId).catch((e) => {
      this.logger.warn(`Changelog archiving failed for ${sourceId}: ${asMessage(e)}`);
      warnings.push({ code: 'errors.collect.changelogs', params: { error: asMessage(e) } });
      return null;
    });
    if (archive && archive.failed > 0) {
      warnings.push({
        code: 'errors.collect.changelogsPartial',
        params: { count: String(archive.failed) },
      });
    }

    return { snapshots: created.map(toPublic), warnings };
  }

  /**
   * The history of each requested metric over a filter, bucketed for a chart.
   *
   * Several at once because the metric list plots one line per card and they
   * all read the same table over the same period: a single query, then a fold
   * per metric — each in its own unit, which is why they cannot simply be
   * summed together.
   *
   * Snapshots are stored per dimension **combination** — `{type, client, app}`
   * all at once — while a reader filters on a subset of them, often on nothing
   * at all. Matching the stored record exactly would therefore find nothing the
   * moment a filter is on, and nothing at all once a classification rule
   * changes the shape of the combinations; the chart went silent and the page
   * looked like it had ignored the filter.
   *
   * So every combination that satisfies the filter is folded together, the same
   * way the current value is. Within a day and within one combination the last
   * snapshot wins: a DORA value is already an aggregate over a rolling window,
   * so the reading at the end of the day is what that day means, where
   * averaging aggregates would blur two different things together.
   */
  async series(
    sourceId: string,
    q: {
      metrics: string[];
      dimensions: Record<string, string>;
      from?: string;
      to?: string;
    },
  ): Promise<MetricSeries[]> {
    const rows = await this.snapshotsMatching({
      sourceId,
      metrics: q.metrics,
      dimensions: q.dimensions,
      from: q.from,
      to: q.to,
    });

    // Every metric asked for answers, empty included: a caller drawing a line
    // per card needs to know which ones have no history rather than having to
    // tell "absent" from "not asked for".
    return q.metrics.map((metric) => {
      const of = rows.filter((row) => row.metric === metric);
      return {
        metric,
        dimensions: q.dimensions,
        // Days: the collection runs every few minutes, so a year of raw
        // snapshots is tens of thousands of rows no plot can say anything with.
        bucket: 'day',
        points: foldTrend(of, unitOf(metric)),
        snapshotCount: of.length,
      };
    });
  }

  /**
   * Snapshots of the given metrics whose combination satisfies a partial filter.
   *
   * "Everything that is prod, whatever the client" is a containment question,
   * not an equality one: a combination is not a subset of the filter that
   * selects it. The test runs here rather than in the database — a jsonb subset
   * predicate is awkward to express through Prisma, and the rows are already
   * bounded by the metric and the period.
   */
  async snapshotsMatching(q: {
    sourceId: string;
    metrics: string[];
    dimensions: Record<string, string>;
    from?: string;
    to?: string;
  }): Promise<
    Array<{ metric: string; value: number; dimensions: Record<string, string>; capturedAt: Date }>
  > {
    const rows = await this.prisma.metricSnapshot.findMany({
      where: {
        sourceId: q.sourceId,
        metric: { in: q.metrics },
        ...(q.from || q.to
          ? {
              capturedAt: {
                gte: q.from ? new Date(q.from) : undefined,
                lte: q.to ? new Date(q.to) : undefined,
              },
            }
          : {}),
      },
      orderBy: { capturedAt: 'asc' },
      select: { metric: true, value: true, dimensions: true, capturedAt: true },
    });

    return rows
      .map((row) => ({
        metric: row.metric,
        value: row.value,
        dimensions: (row.dimensions ?? {}) as Record<string, string>,
        capturedAt: row.capturedAt,
      }))
      .filter((row) =>
        Object.entries(q.dimensions).every(([key, value]) => row.dimensions[key] === value),
      );
  }

  /** Time-series read for trends (optionally filtered by metric / range). */
  async history(
    sourceId: string,
    q: HistoryQuery,
    window: PageWindow,
  ): Promise<Page<MetricSnapshotPublic>> {
    const where = {
      sourceId,
      ...(q.metric ? { metric: q.metric } : {}),
      ...(q.from || q.to
        ? {
            capturedAt: {
              gte: q.from ? new Date(q.from) : undefined,
              lte: q.to ? new Date(q.to) : undefined,
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.metricSnapshot.findMany({
        where,
        orderBy: { capturedAt: 'asc' },
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.metricSnapshot.count({ where }),
    ]);
    return toPage(rows.map(toPublic), total, window);
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The one job id a source's deep re-read is ever enqueued under.
 *
 * Prefixed rather than being the source id alone: the queue also carries this
 * source's scheduled collections, which BullMQ names for it, and two kinds of
 * work sharing an id would make each of them cancel the other.
 *
 * Separated by a dash and not by the colon this kind of key usually takes:
 * BullMQ builds its own Redis keys around `:` and refuses a custom id carrying
 * one — `Custom Id cannot contain :`, raised where the job is created and
 * nowhere earlier, so the whole deep re-read answered 500.
 */
export function refreshJobId(sourceId: string): string {
  return `refresh-${sourceId}`;
}

/** Same constraint, same shape — one replay per source at a time. */
export function rebuildJobId(sourceId: string): string {
  return `rebuild-${sourceId}`;
}

/**
 * Whether nothing more will happen to a job in this state.
 *
 * A whitelist rather than a list of the states known to be running: BullMQ has
 * grown states before (`prioritized`, `waiting-children`), and one it grows next
 * has to read as "still going" here. Mistaking a running job for a finished one
 * would let a second deep read start alongside the first, which is the one
 * outcome this whole id scheme exists to prevent.
 *
 * `unknown` is in because it is what BullMQ answers for a job it can no longer
 * place at all — one evicted between the fetch and this call. There is nothing
 * left to collide with.
 */
function settled(state: string): boolean {
  return state === 'completed' || state === 'failed' || state === 'unknown';
}

function toPublic(r: {
  id: string;
  sourceId: string;
  metric: string;
  value: number;
  dimensions: unknown;
  capturedAt: Date;
}): MetricSnapshotPublic {
  return {
    id: r.id,
    sourceId: r.sourceId,
    metric: r.metric,
    value: r.value,
    dimensions: (r.dimensions as Record<string, string>) ?? {},
    capturedAt: r.capturedAt.toISOString(),
  };
}

/** Start of the bucket a moment falls in, in UTC. */
