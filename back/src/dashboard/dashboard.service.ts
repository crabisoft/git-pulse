import { Injectable, Logger } from '@nestjs/common';
import type {
  DashboardEnvironment,
  DashboardLive,
  Deployment,
  PullRequest,
  Pipeline,
  CodedMessage,
} from '@repo/shared';
import { SourcesService } from '../sources/sources.service';
import { ConnectorFactory } from '../sources/connectors/connector.factory';
import { EnvRulesService } from '../env-rules/env-rules.service';
import { SettingsService } from '../settings/settings.service';
import { paginate, toWindow } from '../common/pagination';
import { throwIfAborted } from '../common/request-abort';
import type { DashboardLiveQueryDto } from './dto/dashboard-live-query.dto';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly sources: SourcesService,
    private readonly connectors: ConnectorFactory,
    private readonly envRules: EnvRulesService,
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
    const { ctx, kind } = await this.sources.resolveContext(sourceId, signal);
    const connector = this.connectors.for(kind);
    const warnings: CodedMessage[] = [];

    const allRepos = await connector.listRepositories(ctx).catch((e) => {
      throwIfAborted(signal);
      warnings.push({ code: 'dashboard.warn.reposFailed', params: { error: asMessage(e) } });
      return [] as string[];
    });
    const repos = filterRepos(allRepos, query.repos);

    const pullRequests = await safe(
      () => connector.listPullRequests(ctx, repos),
      warnings,
      'dashboard.warn.prsFailed',
      signal,
    );
    const pipelines = await safe(
      () => connector.listPipelines(ctx, repos),
      warnings,
      'dashboard.warn.pipelinesFailed',
      signal,
    );
    const deployments = await safe(
      () => connector.listDeployments(ctx, repos),
      warnings,
      'dashboard.warn.deploymentsFailed',
      signal,
    );
    const environments = await this.toEnvironments(sourceId, deployments);
    const { stalePrHours, pageSize } = await this.settings.get();

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
      repos: allRepos,
      summary: summarize(pullRequests, pipelines, environments, stalePrHours),
      warnings,
    };
  }

  /**
   * Environments observed in the deployments, resolved against the source's
   * rules. Names no rule matches are kept as-is, without attributes.
   */
  private async toEnvironments(
    sourceId: string,
    deployments: Deployment[],
  ): Promise<DashboardEnvironment[]> {
    const byName = new Map<string, Deployment[]>();
    for (const d of deployments) {
      const bucket = byName.get(d.environment);
      if (bucket) bucket.push(d);
      else byName.set(d.environment, [d]);
    }

    const entries = [...byName.entries()];
    const classified = await this.envRules.classifyMany(
      sourceId,
      entries.map(([name]) => name),
    );
    return entries
      .map(([, items], i) => {
        const env = classified[i];
        const latest = items.reduce(mostRecent);
        return {
          name: env.name,
          attributes: env.attributes,
          metaEnvironments: env.metaEnvironments,
          repos: [...new Set(items.map((d) => d.repo))].sort(),
          deployments: items.length,
          lastDeployAt: latest.createdAt,
          lastStatus: latest.status,
        };
      })
      .sort((a, b) => msOf(b.lastDeployAt) - msOf(a.lastDeployAt));
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

/** Reducer keeping the most recently created deployment. */
function mostRecent(a: Deployment, b: Deployment): Deployment {
  return msOf(b.createdAt) > msOf(a.createdAt) ? b : a;
}

function msOf(date: string): number {
  return new Date(date).getTime();
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
