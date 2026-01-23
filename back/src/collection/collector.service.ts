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
    this.logger.log(`Relecture complète de ${sourceId} mise en file (${id}).`);
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
      this.logger.warn(`Ingestion échouée pour ${sourceId} : ${asMessage(e)}`);
      warnings.push({ code: 'errors.collect.ingest', params: { error: asMessage(e) } });
    });

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
      this.logger.warn(`Snapshot DORA échoué pour ${sourceId} : ${asMessage(e)}`);
      warnings.push({ code: 'errors.collect.dora', params: { error: asMessage(e) } });
    });

    // Last, and best-effort like the rest — but the only step here whose work
    // cannot be made up later: a deployment nobody filed before its environment
    // was torn down is a changelog no future run can produce.
    const archive = await this.changelogs.archive(sourceId).catch((e) => {
      this.logger.warn(`Archivage des changelogs échoué pour ${sourceId} : ${asMessage(e)}`);
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
   * A metric's history over a filter, bucketed for a chart.
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
      metric: string;
      dimensions: Record<string, string>;
      from?: string;
      to?: string;
    },
  ): Promise<MetricSeries> {
    const rows = await this.snapshotsMatching({
      sourceId,
      metric: q.metric,
      dimensions: q.dimensions,
      from: q.from,
      to: q.to,
    });

    return {
      metric: q.metric,
      dimensions: q.dimensions,
      // Days: the collection runs every few minutes, so a year of raw
      // snapshots is tens of thousands of rows no plot can say anything with.
      bucket: 'day',
      points: foldTrend(rows, unitOf(q.metric)),
      snapshotCount: rows.length,
    };
  }

  /**
   * Snapshots of one metric whose combination satisfies a partial filter.
   *
   * "Everything that is prod, whatever the client" is a containment question,
   * not an equality one: a combination is not a subset of the filter that
   * selects it. The test runs here rather than in the database — a jsonb subset
   * predicate is awkward to express through Prisma, and the rows are already
   * bounded by the metric and the period.
   */
  async snapshotsMatching(q: {
    sourceId: string;
    metric: string;
    dimensions: Record<string, string>;
    from?: string;
    to?: string;
  }): Promise<Array<{ value: number; dimensions: Record<string, string>; capturedAt: Date }>> {
    const rows = await this.prisma.metricSnapshot.findMany({
      where: {
        sourceId: q.sourceId,
        metric: q.metric,
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
      select: { value: true, dimensions: true, capturedAt: true },
    });

    return rows
      .map((row) => ({
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
 */
export function refreshJobId(sourceId: string): string {
  return `refresh:${sourceId}`;
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
