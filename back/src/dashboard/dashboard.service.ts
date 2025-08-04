import { Injectable, Logger } from '@nestjs/common';
import type { DashboardLive, PullRequest, Pipeline } from '@repo/shared';
import { SourcesService } from '../sources/sources.service';
import { ConnectorFactory } from '../sources/connectors/connector.factory';

/** Age (hours) beyond which a PR/MR is considered stale. */
const STALE_HOURS = 72;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly sources: SourcesService,
    private readonly connectors: ConnectorFactory,
  ) {}

  /** Live view (PRs/MRs + pipelines) for a given source. */
  async live(sourceId: string): Promise<DashboardLive> {
    const { ctx, kind } = await this.sources.resolveContext(sourceId);
    const connector = this.connectors.for(kind);
    const warnings: string[] = [];

    const repos = await connector.listRepositories(ctx).catch((e) => {
      warnings.push(`Découverte des repos échouée : ${asMessage(e)}`);
      return [] as string[];
    });

    const pullRequests = await safe(
      () => connector.listPullRequests(ctx, repos),
      warnings,
      'PR/MR',
    );
    const pipelines = await safe(
      () => connector.listPipelines(ctx, repos),
      warnings,
      'pipelines',
    );

    return {
      sourceId,
      pullRequests: sortByAge(pullRequests),
      pipelines,
      summary: summarize(pullRequests, pipelines),
      warnings,
    };
  }
}

async function safe<T>(fn: () => Promise<T[]>, warnings: string[], label: string): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    warnings.push(`Collecte ${label} échouée : ${asMessage(e)}`);
    return [];
  }
}

function sortByAge(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => b.ageHours - a.ageHours);
}

function summarize(prs: PullRequest[], pipelines: Pipeline[]): DashboardLive['summary'] {
  return {
    openPrs: prs.length,
    stalePrs: prs.filter((p) => p.ageHours >= STALE_HOURS).length,
    failedPipelines: pipelines.filter((p) => p.status === 'failed').length,
    runningPipelines: pipelines.filter((p) => p.status === 'running').length,
  };
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
