import { Injectable } from '@nestjs/common';
import type {
  DashboardEnvironment,
  DoraResult,
  OverviewEvent,
  OverviewFlow,
  OverviewFriction,
  OverviewHealth,
  OverviewReport,
} from '@repo/shared';
import { DashboardService, type CollectedSource } from '../dashboard/dashboard.service';
import { foldEnvironments, type DimensionedDeployment } from '../dashboard/environments';
import { within } from '../common/period';
import { DoraService } from '../dora/dora.service';
import { JobsService } from '../jobs/jobs.service';
import { ApiQuotaService } from '../api-quota/api-quota.service';
import { SettingsService } from '../settings/settings.service';
import { flowsFrom } from './flow';
import type { OverviewQueryDto } from './dto/overview-query.dto';

/**
 * How far back the recent-activity window reaches.
 *
 * Two days, and deliberately not the selected period: what this feeds answers
 * "what has just happened", which is a different question from "how did the
 * quarter go" — the period governs the metrics, and the journal is a rail you
 * read down after an alert.
 *
 * Two rather than one because a Monday morning has to show Friday evening:
 * a day-wide window makes the journal empty on any source that deploys on
 * weekdays, at the hour somebody is most likely to be looking. The control
 * room's frieze draws the last day of this and filters the rest itself — its
 * axis is a day wide, and older marks would pile against its left edge.
 */
const EVENT_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Most points a sparkline is drawn from — more would be noise at that width.
 *
 * A ceiling and not a count: the period is cut into at most this many slices,
 * and never into pieces shorter than a day. A week therefore draws seven
 * points, a quarter twelve.
 */
const TREND_POINTS = 12;

@Injectable()
export class OverviewService {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly dora: DoraService,
    private readonly jobs: JobsService,
    private readonly quotas: ApiQuotaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Everything the overview reads, in one round.
   *
   * The vocabularies are collected before the dimension filter is applied, so
   * narrowing one dimension never empties the list the next one is picked
   * from. The environments come back flat: the page groups and pivots them,
   * and a window would cut a pivot in half.
   */
  async report(
    sourceId: string,
    query: OverviewQueryDto,
    /**
     * Whether the caller holds an account. Only the operational half of the
     * health block depends on it; everything else an anonymous visitor could
     * already read from the dashboard.
     */
    signedIn: boolean,
    signal?: AbortSignal,
  ): Promise<OverviewReport> {
    const dimensionFilter = toFilter(query.dimension);
    // The period first: the board reports over it now, so the collection has to
    // know how far back to read before it reads.
    const { results, period, trend } = await this.doraFor(sourceId, query, dimensionFilter);
    const collected = await this.dashboard.collect(sourceId, query.repos, signal, readFrom(period));

    // Filtered as deployments, then folded — never the other way round. A row
    // spans repos that need not classify alike, so narrowing it after the fold
    // would leave it counting deployments it no longer describes, and would
    // hide an attribute only one of its repos carries.
    const matching = collected.deployments.filter(
      (d) => matches(d.attributes, dimensionFilter) && carriesMeta(d.metaEnvironments, query.meta),
    );
    // The board is a report over the period: a row's count and its heartbeat
    // describe the window, and an environment nothing reached inside it is not
    // a row. The journal below is not — it is a rail of the recent past,
    // whatever the period says, so it reads the unbounded list.
    const environments = foldEnvironments(matching.filter((d) => within(d.createdAt, period)));
    // And what runs is a third question again, which no period narrows: an
    // environment last deployed forty days ago is absent from a seven-day
    // window and is still what is live for that client. The matrix exists to
    // show exactly that — a version that has *not* moved — so it reads this.
    const running = foldEnvironments(
      collected.latest.filter(
        (d) => matches(d.attributes, dimensionFilter) && carriesMeta(d.metaEnvironments, query.meta),
      ),
    );
    const { stalePrHours } = await this.settings.get();

    return {
      sourceId,
      environments,
      running,
      // Over both lists: a value only an environment outside the period carries
      // is still a value the filter has to offer, or narrowing the period would
      // quietly remove the dimension you would widen back on.
      dimensions: vocabulary([...collected.deployments, ...collected.latest]),
      metaEnvironments: metaNames([...collected.deployments, ...collected.latest]),
      repos: collected.repos,
      flow: flowsFrom(results, trend),
      friction: friction(collected, results, stalePrHours),
      health: await this.health(collected, signedIn),
      events: events(matching),
      period,
      warnings: collected.warnings,
    };
  }

  /**
   * The metrics over the requested period, already sliced by the filter, and
   * how each of them moved across it.
   *
   * The movement is computed from the same gathering as the figures rather than
   * read back from the historised snapshots. A snapshot holds what a metric was
   * worth over the collection's own window on the day it was taken, so every
   * period was shown the same line — which is exactly what a reader changing
   * the period notices and cannot explain.
   */
  private async doraFor(
    sourceId: string,
    query: OverviewQueryDto,
    dimensions: Record<string, string>,
  ) {
    const report = await this.dora.reportOverTime(
      sourceId,
      {
        from: query.from,
        to: query.to,
        windowDays: query.windowDays,
        repos: query.repos,
        dimensions,
      },
      TREND_POINTS,
    );
    return { results: report.results, period: report.period, trend: report.trend };
  }

  /**
   * Whether what the page shows can be trusted. The queue state is the one
   * worth watching: the API keeps serving stored data while nothing at all is
   * being collected behind it.
   */
  private async health(collected: CollectedSource, signedIn: boolean): Promise<OverviewHealth> {
    const age = {
      mode: collected.mode,
      syncedAt: collected.syncedAt,
      staleForSec: collected.syncedAt
        ? Math.max(0, Math.round((Date.now() - new Date(collected.syncedAt).getTime()) / 1000))
        : null,
    };
    // Not merely blanked afterwards: a visitor's request must not spend a
    // Redis round trip and a quota read on figures they will not be shown.
    if (!signedIn) return { ...age, queues: null, quotaLeft: null };

    const snapshot = await this.jobs.snapshot();
    const queues = snapshot.unreachable
      ? 'unreachable'
      : snapshot.queues.some((q) => q.paused || q.counts.failed > 0)
        ? 'degraded'
        : 'ok';

    const rows = await this.quotas.list();
    // The tightest bucket is the one that will refuse the next call, so it is
    // the one worth reporting. Averaging them would hide exactly that.
    const shares = rows
      .filter((row) => row.subjectKind === 'source' && row.limit > 0)
      .map((row) => row.remaining / row.limit);

    return { ...age, queues, quotaLeft: shares.length > 0 ? Math.min(...shares) : null };
  }
}

/**
 * How far back the collection has to read.
 *
 * The furthest of the two windows drawn from that one list: the board reports
 * over the period, and the journal covers the recent past whatever the period
 * is. A period of one day would otherwise cost the journal its second day.
 */
function readFrom(period: { from: string }): string {
  const journal = Date.now() - EVENT_WINDOW_MS;
  return new Date(Math.min(new Date(period.from).getTime(), journal)).toISOString();
}

/** Turns the `key:value` pairs into the record everything filters on. */
function toFilter(pairs?: string[]): Record<string, string> {
  const filter: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const separator = pair.indexOf(':');
    filter[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return filter;
}

/** Every entry of the filter must match for the subject to be kept. */
function matches(attributes: Record<string, string>, filter: Record<string, string>): boolean {
  return Object.entries(filter).every(([key, value]) => attributes[key] === value);
}

function carriesMeta(metaEnvironments: string[], meta?: string): boolean {
  return !meta || metaEnvironments.includes(meta);
}

/**
 * Dimension key → observed values, over every deployment rather than the
 * filtered ones. A key an environment does not carry is still a key: the
 * filter has to offer it, or a classification gap becomes invisible.
 *
 * Read from the deployments, not from the folded rows: a value only one repo
 * of a shared environment name carries is absent from the row — deliberately,
 * since the row is not true of it — and would otherwise be unpickable.
 */
function vocabulary(deployments: DimensionedDeployment[]): Record<string, string[]> {
  const seen = new Map<string, Set<string>>();
  for (const deployment of deployments) {
    for (const [key, value] of Object.entries(deployment.attributes)) {
      const values = seen.get(key) ?? new Set<string>();
      values.add(value);
      seen.set(key, values);
    }
  }
  return Object.fromEntries(
    [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, [...values].sort()]),
  );
}

function metaNames(deployments: DimensionedDeployment[]): string[] {
  return [...new Set(deployments.flatMap((d) => d.metaEnvironments))].sort();
}

/** What is in the way, counted over everything collected rather than a page. */
function friction(
  collected: CollectedSource,
  results: DoraResult[],
  staleHours: number,
): OverviewFriction {
  // Review time is already computed for the DORA page; recomputing it here
  // from the pull requests would be a second definition of the same word.
  const review = results.filter((r) => r.metric === 'review_time');
  const sampled = review.reduce((total, r) => total + r.sampleSize, 0);
  return {
    openPrs: collected.pullRequests.length,
    stalePrs: collected.pullRequests.filter((pr) => pr.ageHours >= staleHours).length,
    failedPipelines: collected.pipelines.filter((p) => p.status === 'failed').length,
    runningPipelines: collected.pipelines.filter((p) => p.status === 'running').length,
    reviewTimeSec:
      sampled > 0
        ? review.reduce((total, r) => total + r.value * r.sampleSize, 0) / sampled
        : null,
  };
}

/**
 * The deployments of the recent window, already filtered, each carrying its own
 * attributes — that is what lets the frieze draw one lane per client, or per
 * app, without a second request.
 *
 * Its own, not its environment's: two repos deploying to the same environment
 * name can classify differently, and the lane an event belongs to is decided
 * by what that deployment is, not by what its row could agree on.
 */
function events(deployments: DimensionedDeployment[]): OverviewEvent[] {
  const since = Date.now() - EVENT_WINDOW_MS;
  return deployments
    .filter((d) => new Date(d.createdAt).getTime() >= since)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((d) => ({
      id: d.id,
      at: d.createdAt,
      environment: d.environment,
      repo: d.repo,
      ref: d.ref,
      status: d.status,
      url: d.url,
      attributes: d.attributes,
    }));
}
