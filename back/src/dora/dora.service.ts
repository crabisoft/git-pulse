import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import type {
  Deployment,
  DoraPeriod,
  DoraReport,
  DoraResult,
  Incident,
  MergedPullRequest,
  PipelineStatus,
  RuleTarget,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { paginate, type PageWindow } from '../common/pagination';
import { resolvePeriod, within } from '../common/period';
import { throwIfAborted } from '../common/request-abort';
import { PrismaService } from '../prisma/prisma.service';
import { SourcesService } from '../sources/sources.service';
import { ReaderFactory } from '../ingest/reader.factory';
import { EnvRulesService } from '../env-rules/env-rules.service';
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
   * Read-side view: the same computation, sliced by dimension and paginated,
   * plus the vocabularies the filter controls are built from. Those are
   * collected before slicing, so narrowing a filter never empties the list you
   * pick from.
   */
  async report(
    sourceId: string,
    query: DoraQuery,
    window: PageWindow,
    signal?: AbortSignal,
  ): Promise<DoraReport> {
    const { results, repos, period } = await this.build(sourceId, query, signal);
    const dimensions = collectDimensions(results);
    const sliced = results.filter((r) => matchesDimensions(r.dimensions, query.dimensions));
    return { results: paginate(sliced, window), repos, dimensions, period };
  }

  /** Fetches and computes everything, before any slicing. */
  private async build(
    sourceId: string,
    query: DoraQuery,
    signal?: AbortSignal,
  ): Promise<{ results: DoraResult[]; repos: string[]; period: ResolvedRange }> {
    const reader = await this.readers.for(sourceId, signal);
    const period = await this.resolveRange(query);
    const allRepos = await reader.listRepositories();
    // Scoping here rather than after the fact: the connectors iterate repo by
    // repo, so a narrower list is also fewer API calls.
    const repos = filterRepos(allRepos, query.repos);

    const { failureSource, incidentLabels } = await this.settings.get();
    // Which tracker the incidents come from is a property of the source, not of
    // its Git platform: a GitHub org may well file its incidents elsewhere.
    const incidentTracker =
      failureSource === 'pipelines' ? null : await this.trackers.incidentTrackerFor(sourceId);
    if (failureSource !== 'pipelines' && !incidentTracker) {
      this.logger.warn(
        `Aucun tracker d'incidents désigné pour ${sourceId} : le taux d'échec et le MTTR ` +
          `ne compteront que les pipelines.`,
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
      reader.listDeployments(repos).catch((e) => {
        throwIfAborted(signal);
        this.logger.warn(`listDeployments échoué (${sourceId}) : ${asMessage(e)}`);
        return [] as Deployment[];
      }),
      reader.listMergedPullRequests(repos, period.from).catch((e) => {
        throwIfAborted(signal);
        this.logger.warn(`listMergedPullRequests échoué (${sourceId}) : ${asMessage(e)}`);
        return [] as MergedPullRequest[];
      }),
      // Not fetched at all while failures come from pipelines only: the issues
      // endpoint costs one call per label and per repo.
      !incidentTracker || !ctx
        ? Promise.resolve([] as Incident[])
        : this.incidents
            .for(incidentTracker.kind)
            .listIncidents({ access: ctx, repos, labels: incidentLabels }, period)
            .catch((e) => {
              throwIfAborted(signal);
              this.logger.warn(`listIncidents échoué (${sourceId}) : ${asMessage(e)}`);
              return [] as Incident[];
            }),
    ]);

    const owner = reader.scope.owner;
    const [deploymentEvents, prEvents, incidentEvents] = await Promise.all([
      this.toDeploymentEvents(sourceId, deployments, period),
      this.toMergedPrEvents(sourceId, owner, mergedPrs, period),
      this.toIncidentEvents(sourceId, owner, incidents, period),
    ]);

    // A shared ticket between an incident and a merged pull request says which
    // deployment broke what — the question the failure rate actually asks.
    const linked = incidentsByDeployment(incidentEvents, prEvents, deploymentEvents);

    // What is left divides by deployments, so a slice with no deployment
    // produces no rate at all. Saying so beats letting numbers go missing.
    const orphans = orphanIncidentDimensions(deploymentEvents, incidentEvents, linked);
    if (orphans.length > 0) {
      this.logger.warn(
        `${orphans.length} combinaison(s) de dimensions ont des incidents sans déploiement ` +
          `(${sourceId}) : ${orphans.map((d) => JSON.stringify(d)).join(', ')}`,
      );
    }

    return {
      results: [
        ...deploymentFrequency(deploymentEvents),
        ...changeFailureRate(deploymentEvents, incidentEvents, failureSource, linked),
        ...mttr(deploymentEvents, incidentEvents, failureSource, linked),
        ...leadTimeBreakdown(prEvents),
        ...deployTime(prEvents, deploymentEvents),
      ],
      // The full list stays the filter vocabulary, exactly like the dashboard.
      repos: allRepos,
      period,
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
    period: ResolvedRange,
  ): Promise<DeploymentEvent[]> {
    const inWindow = deployments.filter((d) => within(d.createdAt, period));
    const dimensionsByEnv = await this.dimensionsFor(
      sourceId,
      inWindow.map((d) => d.environment),
      'environment',
    );

    return inWindow.map((d) => ({
      environment: d.environment,
      repo: d.repo,
      status: toEventStatus(d.status),
      createdAt: d.createdAt,
      dimensions: dimensionsByEnv.get(d.environment) ?? {},
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
    period: ResolvedRange,
  ): Promise<MergedPrEvent[]> {
    // The connector already filtered on `from`; only the upper bound is left.
    const inWindow = prs.filter((p) => within(p.mergedAt, period));
    const [dimensionsByRepo, tickets] = await Promise.all([
      this.dimensionsFor(sourceId, inWindow.map((p) => p.repo), 'repository'),
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
      dimensions: dimensionsByRepo.get(p.repo) ?? {},
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
    period: ResolvedRange,
  ): Promise<IncidentEvent[]> {
    const inWindow = incidents.filter((i) => within(i.openedAt, period));
    const [dimensionsByLabel, tickets] = await Promise.all([
      this.dimensionsFor(sourceId, inWindow.flatMap((i) => i.labels), 'incident'),
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
        for (const [key, value] of Object.entries(dimensionsByLabel.get(label) ?? {})) {
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

  /** Classifies each distinct name once; the rules are read in a single query. */
  private async dimensionsFor(
    sourceId: string,
    names: string[],
    target: RuleTarget,
  ): Promise<Map<string, Record<string, string>>> {
    const distinct = [...new Set(names)];
    const classified = await this.envRules.classifyMany(sourceId, distinct, target);
    return new Map(distinct.map((name, i) => [name, classified[i].attributes]));
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

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toEventStatus(status: PipelineStatus): DeploymentEvent['status'] {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  return 'other';
}

