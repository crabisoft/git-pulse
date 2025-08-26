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

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly sources: SourcesService,
    private readonly connectors: ConnectorFactory,
    private readonly envRules: EnvRulesService,
    private readonly settings: SettingsService,
  ) {}

  /** Live view (PRs/MRs + pipelines) for a given source. */
  async live(sourceId: string): Promise<DashboardLive> {
    const { ctx, kind } = await this.sources.resolveContext(sourceId);
    const connector = this.connectors.for(kind);
    const warnings: CodedMessage[] = [];

    const repos = await connector.listRepositories(ctx).catch((e) => {
      warnings.push({ code: 'dashboard.warn.reposFailed', params: { error: asMessage(e) } });
      return [] as string[];
    });

    const pullRequests = await safe(
      () => connector.listPullRequests(ctx, repos),
      warnings,
      'dashboard.warn.prsFailed',
    );
    const pipelines = await safe(
      () => connector.listPipelines(ctx, repos),
      warnings,
      'dashboard.warn.pipelinesFailed',
    );
    const deployments = await safe(
      () => connector.listDeployments(ctx, repos),
      warnings,
      'dashboard.warn.deploymentsFailed',
    );
    const environments = await this.toEnvironments(sourceId, deployments);
    const { stalePrHours } = await this.settings.get();

    return {
      sourceId,
      pullRequests: sortByAge(pullRequests),
      pipelines,
      environments,
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

async function safe<T>(
  fn: () => Promise<T[]>,
  warnings: CodedMessage[],
  code: string,
): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    warnings.push({ code, params: { error: asMessage(e) } });
    return [];
  }
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
