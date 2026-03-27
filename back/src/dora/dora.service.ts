import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { DORA_METRICS } from '@repo/shared';
import type {
  Deployment,
  DoraMetric,
  DoraPeriod,
  DoraReport,
  DoraResult,
  DoraSample,
  FailureSource,
  Incident,
  MergedPullRequest,
  Page,
  PipelineStatus,
  RuleTarget,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';

import { resolvePeriod, within } from '../common/period';
import { paginate, type PageWindow } from '../common/pagination';
import { foldByMetric } from './aggregate';
import { sliceRange } from './series';
import { throwIfAborted } from '../common/request-abort';
import { PrismaService } from '../prisma/prisma.service';
import { SourcesService } from '../sources/sources.service';
import { ReaderFactory } from '../ingest/reader.factory';
import { EnvRulesService, subjectKey, type ClassifySubject } from '../env-rules/env-rules.service';
import { IncidentProviderFactory } from '../incidents/incident-provider.factory';
import { TrackersService } from '../trackers/trackers.service';
import { TicketRulesService } from '../ticket-rules/ticket-rules.service';
import { SettingsService } from '../settings/settings.service';
import {
  deploymentFrequency,
  changeFailureRate,
  deployTime,
  incidentsByDeployment,
  mttr,
  leadTimeBreakdown,
  orphanIncidentDimensions,
  type DeploymentEvent,
  type IncidentEvent,
  type MeasuredResult,
  type MergedPrEvent,
} from './dora-metrics';

/** Explicit reporting period; each bound falls back to the rolling window. */
export interface DoraRange {
  from?: string;
  to?: string;
  /** Length of the rolling window, in days. Unused once `from` is supplied. */
  windowDays?: number;
}

/** The period, plus what scopes the collection and what slices the results. */
export interface DoraQuery extends DoraRange {
  /** Repos to collect from; empty or omitted means every repo in scope. */
  repos?: string[];
  /** Every entry must match for a result to be kept. */
  dimensions?: Record<string, string>;
}

/** A resolved period — both bounds are ISO strings, `from` <= `to`. */
type ResolvedRange = DoraPeriod;

/** What a replay of the metric history did — see `rebuild`. */
export interface MetricRebuild {
  from: string;
  to: string;
  /** Days that produced at least one reading; the empty ones write nothing. */
  days: number;
  written: number;
  replaced: number;
  /** Snapshots left untouched before the range, classified as they were then. */
  keptBefore: number;
}

/** One read of a source, classified once and reusable over any period. */
interface GatheredEvents {
  deploymentEvents: DeploymentEvent[];
  prEvents: MergedPrEvent[];
  incidentEvents: IncidentEvent[];
  allRepos: string[];
  failureSource: FailureSource;
}

@Injectable()
export class DoraService {
  private readonly logger = new Logger(DoraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly readers: ReaderFactory,
    private readonly incidents: IncidentProviderFactory,
    private readonly trackers: TrackersService,
    private readonly envRules: EnvRulesService,
    private readonly ticketRules: TicketRulesService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Raw computation, unsliced — what the scheduled snapshot persists. Both
   * bounds are optional: an omitted `to` means now, an omitted `from` means
   * `doraWindowDays` before `to`, so calling with no range keeps the historical
   * rolling-window behavior.
   */
  async compute(sourceId: string, range: DoraRange = {}): Promise<DoraResult[]> {
    return (await this.build(sourceId, range)).results;
  }

  /**
   * Read-side view: the same computation, sliced by dimension and folded into
   * one reading per metric, plus the vocabularies the filter controls are
   * built from. Those are collected before slicing, so narrowing a filter
   * never empties the list you pick from.
   *
   * Folded rather than listed per combination: a reader asks "what is the lead
   * time here", and answers the "here" with the filter bar. A row per
   * combination made the page a cross-product nobody read past the first
   * screen of.
   */
  async report(sourceId: string, query: DoraQuery, signal?: AbortSignal): Promise<DoraReport> {
    const { results, repos, period } = await this.build(sourceId, query, signal);
    const dimensions = collectDimensions(results);
    const sliced = results.filter((r) => matchesDimensions(r.dimensions, query.dimensions));
    return { results: foldByMetric(sliced), repos, dimensions, period };
  }

  /**
   * The same report, plus how each metric moved **across** the period.
   *
   * The series is computed here rather than read back from the historised
   * snapshots, and that is the whole point of the method. A snapshot holds what
   * a metric was worth over the *collection's* configured window on the day it
   * was taken, so the page asking for ninety days and the page asking for seven
   * were shown the same twelve points — the figures moved with the period and
   * the line beside them never did.
   *
   * It costs one gathering and not one per point: classifying an event does not
   * depend on the period, which is the same trick `rebuild` uses to replay
   * ninety days from a single read. Every slice is folded exactly as the report
   * is, so a point on the line and the number beside it are the same
   * computation over different bounds.
   *
   * `maxPoints` is a ceiling, not a count — see `sliceRange`, which also
   * refuses to cut finer than a day.
   */
  async reportOverTime(
    sourceId: string,
    query: DoraQuery,
    maxPoints: number,
    signal?: AbortSignal,
  ): Promise<DoraReport & { trend: DoraResult[][] }> {
    const { results, repos, period, slices } = await this.build(sourceId, query, signal, maxPoints);
    const sliced = (of: (DoraResult | MeasuredResult)[]) =>
      of.filter((r) => matchesDimensions(r.dimensions, query.dimensions));
    return {
      results: foldByMetric(sliced(results)),
      repos,
      dimensions: collectDimensions(results),
      period,
      trend: slices.map((slice) => foldByMetric(sliced(slice))),
    };
  }

  /**
   * The events behind one metric, over the same period and slice as its value,
   * paginated — all of them, not the handful the reading carries.
   *
   * A separate route rather than a bigger report: the reading needs a fixed few
   * events to show without paging, while somebody auditing a figure wants every
   * one of them, and sending thousands of events to every reader of the metric
   * list to serve the occasional audit is the wrong trade both ways.
   */
  async samples(
    sourceId: string,
    query: DoraQuery,
    metric: DoraMetric,
    window: PageWindow,
    signal?: AbortSignal,
  ): Promise<Page<DoraSample>> {
    const { results } = await this.build(sourceId, query, signal);
    const events = results
      .filter((r) => r.metric === metric && matchesDimensions(r.dimensions, query.dimensions))
      // A combination computed before this feature — or one whose metric keeps
      // no population — still answers with what its reading carries.
      .flatMap((r) => ('population' in r ? r.population : r.samples));

    // Newest first, like every list in the product; the fold that produced the
    // reading sorted its own window the same way.
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return paginate(events, window);
  }

  /**
   * Fetches and computes everything, before any slicing by dimension.
   *
   * `maxPoints` asks for the period cut into slices as well, each computed from
   * the same gathering — the events are read once whatever is asked of them.
   */
  private async build(
    sourceId: string,
    query: DoraQuery,
    signal?: AbortSignal,
    maxPoints = 0,
  ): Promise<{
    results: (DoraResult | MeasuredResult)[];
    repos: string[];
    period: ResolvedRange;
    slices: (DoraResult | MeasuredResult)[][];
  }> {
    const period = await this.resolveRange(query);
    const gathered = await this.gather(sourceId, period.from, query.repos, signal);
    const context = { failureSource: gathered.failureSource, sourceId };
    return {
      results: this.computeOver(gathered, period, context),
      // The full list stays the filter vocabulary, exactly like the dashboard.
      repos: gathered.allRepos,
      period,
      slices: sliceRange(period, maxPoints).map((slice) =>
        // Quiet: the slices are the same events a dozen times over, so a gap
        // worth warning about has already been reported by the computation
        // over the whole period, one line above.
        this.computeOver(gathered, { ...slice, windowDays: null }, { ...context, quiet: true }),
      ),
    };
  }

  /**
   * Every event of a source, classified, from `since` onward.
   *
   * Period-free on purpose — see `computeOver`. `since` bounds what the
   * platform is asked for, never what the caller may compute over: every
   * listing here reads back down to it, and each of them may well answer with
   * more.
   *
   * The deployments used to be read unbounded, which sounded generous and was
   * the opposite: unbounded means "the most recent slice", so a busy repo's
   * ninety-day window was computed from its last thirty deployments. The
   * frequency was then a frequency over whatever those spanned.
   */
  private async gather(
    sourceId: string,
    since: string,
    repoFilter: string[] | undefined,
    signal?: AbortSignal,
  ): Promise<GatheredEvents> {
    const reader = await this.readers.for(sourceId, signal);
    const allRepos = await reader.listRepositories();
    // Scoping here rather than after the fact: the connectors iterate repo by
    // repo, so a narrower list is also fewer API calls.
    const repos = filterRepos(allRepos, repoFilter);

    const { failureSource, incidentLabels } = await this.settings.get();
    // Which tracker the incidents come from is a property of the source, not of
    // its Git platform: a GitHub org may well file its incidents elsewhere.
    const incidentTracker =
      failureSource === 'pipelines' ? null : await this.trackers.incidentTrackerFor(sourceId);
    if (failureSource !== 'pipelines' && !incidentTracker) {
      this.logger.warn(
        `No incident tracker set for ${sourceId}: change failure rate and MTTR ` +
          `will count pipelines only.`,
      );
    }

    // Incidents are the one thing the store does not hold: they live in a
    // tracker, which has a budget of its own. A git-hosted tracker borrows this
    // source's credentials, so the context is resolved only when one is in play
    // — a `stored` source counting failures from pipelines decrypts nothing.
    const ctx = incidentTracker ? (await this.sources.resolveContext(sourceId, signal)).ctx : null;

    // Best-effort: a missing permission on one endpoint yields partial metrics
    // rather than failing the whole computation — except for a cancellation,
    // which has nothing to degrade into and must stop the run (throwIfAborted).
    const [deployments, mergedPrs, incidents] = await Promise.all([
      reader.listDeployments(repos, since).catch((e) => {
        throwIfAborted(signal);
        this.logger.warn(`listDeployments failed (${sourceId}): ${asMessage(e)}`);
        return [] as Deployment[];
      }),
      reader.listMergedPullRequests(repos, since).catch((e) => {
        throwIfAborted(signal);
        this.logger.warn(`listMergedPullRequests failed (${sourceId}): ${asMessage(e)}`);
        return [] as MergedPullRequest[];
      }),
      // Not fetched at all while failures come from pipelines only: the issues
      // endpoint costs one call per label and per repo.
      !incidentTracker || !ctx
        ? Promise.resolve([] as Incident[])
        : this.incidents
            .for(incidentTracker.kind)
            .listIncidents(
              { access: ctx, repos, labels: incidentLabels },
              { from: since, to: new Date().toISOString() },
            )
            .catch((e) => {
              throwIfAborted(signal);
              this.logger.warn(`listIncidents failed (${sourceId}): ${asMessage(e)}`);
              return [] as Incident[];
            }),
    ]);

    const owner = reader.scope.owner;
    const [deploymentEvents, prEvents, incidentEvents] = await Promise.all([
      this.toDeploymentEvents(sourceId, deployments),
      this.toMergedPrEvents(sourceId, owner, mergedPrs),
      this.toIncidentEvents(sourceId, owner, incidents),
    ]);

    return { deploymentEvents, prEvents, incidentEvents, allRepos, failureSource };
  }

  /**
   * The metrics over one period, from events already gathered and classified.
   *
   * Separate from the gathering on purpose: classifying a deployment does not
   * depend on the period, so one read can answer many of them. That is what
   * lets `rebuild` replay ninety days without ninety collections — and it is
   * the only reason the period is applied here rather than at the source.
   */
  private computeOver(
    events: {
      deploymentEvents: DeploymentEvent[];
      prEvents: MergedPrEvent[];
      incidentEvents: IncidentEvent[];
    },
    period: ResolvedRange,
    context: { failureSource: FailureSource; sourceId: string; quiet?: boolean },
  ): (DoraResult | MeasuredResult)[] {
    const deploymentEvents = events.deploymentEvents.filter((d) => within(d.createdAt, period));
    const prEvents = events.prEvents.filter((p) => within(p.mergedAt, period));
    const incidentEvents = events.incidentEvents.filter((i) => within(i.openedAt, period));
    const { failureSource, sourceId } = context;

    // A shared ticket between an incident and a merged pull request says which
    // deployment broke what — the question the failure rate actually asks.
    const linked = incidentsByDeployment(incidentEvents, prEvents, deploymentEvents);

    // What is left divides by deployments, so a slice with no deployment
    // produces no rate at all. Saying so beats letting numbers go missing.
    const orphans = orphanIncidentDimensions(deploymentEvents, incidentEvents, linked);
    if (orphans.length > 0 && !context.quiet) {
      this.logger.warn(
        `${orphans.length} dimension combination(s) carry incidents but no deployment ` +
          `(${sourceId}): ${orphans.map((d) => JSON.stringify(d)).join(', ')}`,
      );
    }

    return [
      ...deploymentFrequency(deploymentEvents),
      ...changeFailureRate(deploymentEvents, incidentEvents, failureSource, linked),
      ...mttr(deploymentEvents, incidentEvents, failureSource, linked),
      ...leadTimeBreakdown(prEvents),
      ...deployTime(prEvents, deploymentEvents),
    ];
  }

  /**
   * Replays the metric history from what has already been ingested.
   *
   * One read, then one computation per day: classifying an event does not
   * depend on the period, so replaying ninety days costs one collection rather
   * than ninety. Each day is computed over the **rolling window ending that
   * day** — the same one the scheduled collection uses, without which the
   * replayed points would not mean what the points around them mean.
   *
   * Stops at the end of yesterday. Today belongs to the next collection, and
   * writing it here would put two captures on one day for the same run.
   *
   * The replayed range is deleted before being written, which is what makes
   * this safe to run twice: the daily fold keeps the last capture of a day, so
   * leaving the old ones in place would make the result depend on insertion
   * order. Only the DORA metrics are swept — the summary series shares this
   * table and is a reading of the present, which no replay can reconstruct.
   * Snapshots older than the range are left alone, and counted so the caller
   * can say they are still classified the way they were.
   */
  async rebuild(sourceId: string, days?: number, signal?: AbortSignal): Promise<MetricRebuild> {
    const { doraWindowDays } = await this.settings.get();
    // Omitted means the window the metrics are read over — the readings worth
    // restating first, and the default the settings own.
    const depth = days ?? doraWindowDays;
    const endOfYesterday = endOfDay(addDays(new Date(), -1));
    const firstDay = startOfDay(addDays(endOfYesterday, -(depth - 1)));

    // Each day looks a whole window back, so the read has to start there.
    const gathered = await this.gather(
      sourceId,
      addDays(firstDay, -doraWindowDays).toISOString(),
      undefined,
      signal,
    );

    const rows: Array<{ metric: string; value: number; dimensions: object; capturedAt: Date }> = [];
    let daysWritten = 0;
    for (let day = new Date(firstDay); day <= endOfYesterday; day = addDays(day, 1)) {
      throwIfAborted(signal);
      const capturedAt = endOfDay(day);
      const period: ResolvedRange = {
        from: addDays(capturedAt, -doraWindowDays).toISOString(),
        to: capturedAt.toISOString(),
        windowDays: doraWindowDays,
      };
      const results = this.computeOver(gathered, period, {
        failureSource: gathered.failureSource,
        sourceId,
      });
      // A day with no event produces no result, so it writes no row: an empty
      // window must leave a gap in the series, never a flat zero somebody
      // would read as a measurement.
      if (results.length === 0) continue;
      daysWritten++;
      for (const r of results) {
        rows.push({ metric: r.metric, value: r.value, dimensions: r.dimensions, capturedAt });
      }
    }

    const range = { gte: firstDay, lte: endOfYesterday };
    const [removed] = await this.prisma.$transaction([
      this.prisma.metricSnapshot.deleteMany({
        where: { sourceId, metric: { in: [...DORA_METRICS] }, capturedAt: range },
      }),
      this.prisma.metricSnapshot.createMany({
        data: rows.map((r) => ({ sourceId, ...r, dimensions: r.dimensions as never })),
      }),
    ]);

    const kept = await this.prisma.metricSnapshot.count({
      where: { sourceId, metric: { in: [...DORA_METRICS] }, capturedAt: { lt: firstDay } },
    });

    this.logger.log(
      `DORA history replayed for ${sourceId}: ${rows.length} reading(s) over ${daysWritten} day(s), ` +
        `${removed.count} replaced, ${kept} kept before ${firstDay.toISOString()}.`,
    );
    return {
      from: firstDay.toISOString(),
      to: endOfYesterday.toISOString(),
      days: daysWritten,
      written: rows.length,
      replaced: removed.count,
      keptBefore: kept,
    };
  }

  /** Compute and persist DORA metrics as snapshots. Returns the count written. */
  async snapshot(sourceId: string): Promise<number> {
    const results = await this.compute(sourceId);
    if (results.length === 0) return 0;
    const capturedAt = new Date();
    const created = await this.prisma.$transaction(
      results.map((r) =>
        this.prisma.metricSnapshot.create({
          data: {
            sourceId,
            metric: r.metric,
            value: r.value,
            dimensions: r.dimensions,
            capturedAt,
          },
        }),
      ),
    );
    return created.length;
  }

  /**
   * Applies the defaults and rejects an inverted period. Three ways to ask for
   * a period, by decreasing precedence: an explicit `from`, a rolling
   * `windowDays`, and the configured `doraWindowDays`.
   */
  private async resolveRange(range: DoraRange): Promise<ResolvedRange> {
    return resolvePeriod(range, (await this.settings.get()).doraWindowDays);
  }

  private async toDeploymentEvents(
    sourceId: string,
    deployments: Deployment[],
  ): Promise<DeploymentEvent[]> {
    const dimensionsByEnv = await this.dimensionsFor(
      sourceId,
      deployments.map((d) => ({ name: d.environment, repo: d.repo })),
      'environment',
    );

    return deployments.map((d) => ({
      environment: d.environment,
      repo: d.repo,
      status: toEventStatus(d.status),
      createdAt: d.createdAt,
      dimensions: dimensionsByEnv.get(subjectKey({ name: d.environment, repo: d.repo })) ?? {},
    }));
  }

  /**
   * A PR has no environment, so its dimensions come from classifying the repo
   * name against the `repository` rules. Without such rules every PR lands in
   * the same bucket — the historical behavior.
   */
  private async toMergedPrEvents(
    sourceId: string,
    owner: string,
    prs: MergedPullRequest[],
  ): Promise<MergedPrEvent[]> {
    const inWindow = prs;
    const [dimensionsByRepo, tickets] = await Promise.all([
      // The subject is the repo name, so the repo is known by construction.
      this.dimensionsFor(
        sourceId,
        inWindow.map((p) => ({ name: p.repo, repo: p.repo })),
        'repository',
      ),
      this.ticketRules.extractMany(
        sourceId,
        inWindow.map((p) => ({ branch: p.headRef, title: p.title })),
        inWindow.map((p) => ({ owner, repo: p.repo })),
      ),
    ]);

    return inWindow.map((p, i) => ({
      repo: p.repo,
      number: p.number,
      url: p.url,
      firstCommitAt: p.firstCommitAt,
      openedAt: p.openedAt,
      firstReviewAt: p.firstReviewAt,
      mergedAt: p.mergedAt,
      tickets: tickets[i],
      dimensions: dimensionsByRepo.get(subjectKey({ name: p.repo, repo: p.repo })) ?? {},
    }));
  }

  /**
   * An incident has neither environment nor, usefully, a single name: its
   * dimensions come from classifying each of its labels against the `incident`
   * rules, then merging. On conflict the first label wins, labels being sorted
   * so the outcome does not depend on the tracker's ordering.
   *
   * Deliberately not classified by repo: the failure rate divides incidents by
   * deployments, which are dimensioned by environment. Adding repo-derived
   * attributes would create slices no deployment can ever match.
   */
  private async toIncidentEvents(
    sourceId: string,
    owner: string,
    incidents: Incident[],
  ): Promise<IncidentEvent[]> {
    const inWindow = incidents;
    const [dimensionsByLabel, tickets] = await Promise.all([
      this.dimensionsFor(
        sourceId,
        inWindow.flatMap((i) => i.labels.map((name) => ({ name }))),
        'incident',
      ),
      // Read from the title and the labels, the two places a tracker lets one
      // write a reference. The same rules as pull requests, so a key spelled
      // once is recognised on both sides.
      this.ticketRules.extractMany(
        sourceId,
        inWindow.map((i) => ({ branch: i.labels.join(' '), title: i.title })),
        inWindow.map((i) => ({ owner, repo: i.repo ?? '' })),
      ),
    ]);

    return inWindow.map((i, index) => {
      const dimensions: Record<string, string> = {};
      for (const label of [...i.labels].sort()) {
        for (const [key, value] of Object.entries(
          dimensionsByLabel.get(subjectKey({ name: label })) ?? {},
        )) {
          if (!(key in dimensions)) dimensions[key] = value;
        }
      }
      return {
        key: i.key,
        title: i.title,
        url: i.url,
        openedAt: i.openedAt,
        resolvedAt: i.resolvedAt,
        repo: i.repo,
        tickets: tickets[index],
        dimensions,
      };
    });
  }

  /**
   * Classifies each distinct subject once; the rules are read in a single
   * query. Distinct on the repo as much as on the name — a rule confined to a
   * repo makes one name classify two ways.
   */
  private async dimensionsFor(
    sourceId: string,
    subjects: ClassifySubject[],
    target: RuleTarget,
  ): Promise<Map<string, Record<string, string>>> {
    const classified = await this.envRules.classifyByPair(sourceId, subjects, target);
    return new Map([...classified].map(([key, env]) => [key, env.attributes]));
  }
}

/** Keeps the requested repos, ignoring names outside the source scope. */
function filterRepos(all: string[], wanted?: string[]): string[] {
  if (!wanted || wanted.length === 0) return all;
  const set = new Set(wanted);
  return all.filter((repo) => set.has(repo));
}

/** Dimension key → sorted distinct values, over every computed result. */
function collectDimensions(results: DoraResult[]): Record<string, string[]> {
  const values = new Map<string, Set<string>>();
  for (const result of results) {
    for (const [key, value] of Object.entries(result.dimensions)) {
      const bucket = values.get(key);
      if (bucket) bucket.add(value);
      else values.set(key, new Set([value]));
    }
  }
  return Object.fromEntries(
    [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, set]) => [
      key,
      [...set].sort(),
    ]),
  );
}

/** A result is kept only when it carries every requested key/value pair. */
function matchesDimensions(
  dimensions: Record<string, string>,
  filter?: Record<string, string>,
): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([key, value]) => dimensions[key] === value);
}

/**
 * `2026-01-31` parses as UTC midnight, which would drop that whole day from an
 * inclusive upper bound. A date without a time therefore means end of day (UTC);
 * a full timestamp is taken as-is.
 */

/** Inclusive on both bounds. */

/**
 * Day arithmetic for the replay, in UTC.
 *
 * UTC because that is the boundary the daily fold reads a snapshot's date on
 * (`capturedAt.toISOString().slice(0, 10)`): computing a day here on a local
 * boundary would file readings under a day the chart draws them on a different
 * one.
 */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

function endOfDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(23, 59, 59, 999);
  return day;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toEventStatus(status: PipelineStatus): DeploymentEvent['status'] {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  return 'other';
}

