import { Injectable, Logger } from '@nestjs/common';
import {
  type DashboardEnvironment,
  type DashboardLive,
  type Deployment,
  type PullRequest,
  type Pipeline,
  type CodedMessage,
  type SourceMode,
} from '@repo/shared';
import { ReaderFactory } from '../ingest/reader.factory';
import { EnvRulesService, subjectKey } from '../env-rules/env-rules.service';
import { foldEnvironments, type DimensionedDeployment } from './environments';
import { TicketRulesService } from '../ticket-rules/ticket-rules.service';
import { SettingsService } from '../settings/settings.service';
import { paginate, toWindow } from '../common/pagination';
import { throwIfAborted } from '../common/request-abort';
import type { DashboardLiveQueryDto } from './dto/dashboard-live-query.dto';

/**
 * One collection round, before anything is windowed or counted. Two readers
 * want the same fetch — the live board pages through it, the overview folds it
 * — and doing it twice would be two rounds of connector calls for one screen.
 */
export interface CollectedSource {
  /** Every repo in scope, filter applied or not — the filter's vocabulary. */
  repos: string[];
  pullRequests: PullRequest[];
  pipelines: Pipeline[];
  /**
   * Each carrying its own classification — see `DimensionedDeployment`. Bounded
   * by `since` when the caller asked for a window, and the most recent slice
   * per repo otherwise.
   */
  deployments: DimensionedDeployment[];
  /**
   * The most recent slice per repo, whatever the window — **what runs now**.
   *
   * The same list as `deployments` when no window was asked for. With one, the
   * two answer different questions and both are wanted: an environment last
   * deployed forty days ago is absent from a seven-day window and is still what
   * is running, which is exactly what a matrix of live versions is read for.
   */
  latest: DimensionedDeployment[];
  environments: DashboardEnvironment[];
  mode: SourceMode;
  syncedAt: string | null;
  warnings: CodedMessage[];
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly readers: ReaderFactory,
    private readonly envRules: EnvRulesService,
    private readonly ticketRules: TicketRulesService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Live view (PRs/MRs + pipelines + environments) for a given source. The repo
   * filter is applied before anything else, so the summary always describes the
   * whole filtered data set — never just the returned windows.
   */
  async live(
    sourceId: string,
    query: DashboardLiveQueryDto = {},
    signal?: AbortSignal,
  ): Promise<DashboardLive> {
    const collected = await this.collect(sourceId, query.repos, signal);
    const { stalePrHours, pageSize } = await this.settings.get();
    const { pullRequests, pipelines, environments } = collected;

    return {
      sourceId,
      pullRequests: paginate(
        sortByAge(pullRequests),
        toWindow({ limit: query.prsLimit, offset: query.prsOffset }, pageSize),
      ),
      pipelines: paginate(
        pipelines,
        toWindow({ limit: query.pipelinesLimit, offset: query.pipelinesOffset }, pageSize),
      ),
      environments: paginate(
        environments,
        toWindow({ limit: query.environmentsLimit, offset: query.environmentsOffset }, pageSize),
      ),
      repos: collected.repos,
      summary: summarize(pullRequests, pipelines, environments, stalePrHours),
      mode: collected.mode,
      syncedAt: collected.syncedAt,
      warnings: collected.warnings,
    };
  }

  /**
   * One round of collection, uncounted. A failing listing degrades into a
   * warning rather than emptying the screen: a missing permission on pipelines
   * should not cost the environments too.
   *
   * `since` bounds the deployments alone, and only the callers that report over
   * a period pass it. Omitted, the read is the most recent slice per repo —
   * what a board of the present wants, at the cost a live source would answer
   * at. The pull requests and pipelines never take it: an open pull request and
   * a running pipeline are facts about now, and a period would not narrow them
   * so much as change the question.
   */
  async collect(
    sourceId: string,
    repoFilter?: string[],
    signal?: AbortSignal,
    since?: string,
  ): Promise<CollectedSource> {
    const reader = await this.readers.for(sourceId, signal);
    const warnings: CodedMessage[] = [];

    const allRepos = await reader.listRepositories().catch((e) => {
      throwIfAborted(signal);
      warnings.push({ code: 'dashboard.warn.reposFailed', params: { error: asMessage(e) } });
      return [] as string[];
    });
    const repos = filterRepos(allRepos, repoFilter);

    const pullRequests = await safe(
      () => reader.listPullRequests(repos),
      warnings,
      'dashboard.warn.prsFailed',
      signal,
    );
    const pipelines = await safe(
      () => reader.listPipelines(repos),
      warnings,
      'dashboard.warn.pipelinesFailed',
      signal,
    );
    const deployments = await safe(
      () => reader.listDeployments(repos, since),
      warnings,
      'dashboard.warn.deploymentsFailed',
      signal,
    );

    // An empty board and a board of an empty project look alike; saying the
    // ingestion has not run yet is the difference between the two.
    const syncedAt = await reader.freshness();
    if (reader.mode === 'stored' && syncedAt === null) {
      warnings.push({ code: 'dashboard.warn.neverSynced', params: {} });
    }

    // What runs now, alongside the window. A second listing rather than a
    // second collection: on a stored source it is one more indexed query, and
    // on a live one it is the single most recent page per repo — the bounded
    // read beside it already pages twenty deep, so the pair costs a twentieth
    // more than the window alone.
    const running = since
      ? await safe(
          () => reader.listDeployments(repos),
          warnings,
          'dashboard.warn.deploymentsFailed',
          signal,
        )
      : deployments;

    // Classified once, then folded: the overview folds the same deployments a
    // second time over a narrower set, and both foldings have to mean the same
    // thing by construction.
    const dimensioned = await this.dimension(sourceId, deployments);
    const latest = since ? await this.dimension(sourceId, running) : dimensioned;

    return {
      repos: allRepos,
      pullRequests: await this.withTickets(sourceId, reader.scope.owner, pullRequests),
      pipelines,
      deployments: dimensioned,
      latest,
      environments: foldEnvironments(dimensioned),
      mode: reader.mode,
      syncedAt: syncedAt?.toISOString() ?? null,
      warnings,
    };
  }

  /** Resolves the ticket references of a batch of PRs — rules read once. */
  private async withTickets(
    sourceId: string,
    owner: string,
    prs: PullRequest[],
  ): Promise<PullRequest[]> {
    const refs = await this.ticketRules.extractMany(
      sourceId,
      prs.map((pr) => ({ branch: pr.headRef, title: pr.title })),
      prs.map((pr) => ({ owner, repo: pr.repo })),
    );
    return prs.map((pr, i) => ({ ...pr, tickets: refs[i] }));
  }

  /**
   * Resolves each deployment's environment against the source's rules.
   *
   * Per deployment rather than per name, because the repo is half of what
   * decides a classification. The rows are folded from these, so an
   * environment deployed from one repo carries what a rule confined to that
   * repo says — which is the whole of what such a rule is for.
   */
  private async dimension(
    sourceId: string,
    deployments: Deployment[],
  ): Promise<DimensionedDeployment[]> {
    const classified = await this.envRules.classifyByPair(
      sourceId,
      deployments.map((d) => ({ name: d.environment, repo: d.repo })),
    );
    return deployments.map((deployment) => {
      const env = classified.get(
        subjectKey({ name: deployment.environment, repo: deployment.repo }),
      );
      return {
        ...deployment,
        attributes: env?.attributes ?? {},
        metaEnvironments: env?.metaEnvironments ?? [],
      };
    });
  }
}

/**
 * Degrades a failed collection into a warning and an empty list, so one missing
 * permission never costs the whole view. A cancellation is the exception: there
 * is nothing to show it to, so it propagates instead.
 */
async function safe<T>(
  fn: () => Promise<T[]>,
  warnings: CodedMessage[],
  code: string,
  signal?: AbortSignal,
): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    throwIfAborted(signal);
    warnings.push({ code, params: { error: asMessage(e) } });
    return [];
  }
}

/** Keeps the requested repos, ignoring names outside the source scope. */
function filterRepos(all: string[], wanted?: string[]): string[] {
  if (!wanted || wanted.length === 0) return all;
  const set = new Set(wanted);
  return all.filter((repo) => set.has(repo));
}

function sortByAge(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => b.ageHours - a.ageHours);
}

function summarize(
  prs: PullRequest[],
  pipelines: Pipeline[],
  environments: DashboardEnvironment[],
  staleHours: number,
): DashboardLive['summary'] {
  return {
    openPrs: prs.length,
    stalePrs: prs.filter((p) => p.ageHours >= staleHours).length,
    failedPipelines: pipelines.filter((p) => p.status === 'failed').length,
    runningPipelines: pipelines.filter((p) => p.status === 'running').length,
    environments: environments.length,
  };
}

function msOf(date: string): number {
  return new Date(date).getTime();
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
