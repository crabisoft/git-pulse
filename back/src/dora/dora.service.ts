import { Injectable, Logger } from '@nestjs/common';
import type { Deployment, DoraResult, MergedPullRequest, PipelineStatus } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SourcesService } from '../sources/sources.service';
import { ConnectorFactory } from '../sources/connectors/connector.factory';
import { EnvRulesService } from '../env-rules/env-rules.service';
import { SettingsService } from '../settings/settings.service';
import {
  deploymentFrequency,
  changeFailureRate,
  mttr,
  leadTimeBreakdown,
  type DeploymentEvent,
  type MergedPrEvent,
} from './dora-metrics';

@Injectable()
export class DoraService {
  private readonly logger = new Logger(DoraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly connectors: ConnectorFactory,
    private readonly envRules: EnvRulesService,
    private readonly settings: SettingsService,
  ) {}

  /** Compute DORA metrics over the lookback window for a source. */
  async compute(sourceId: string): Promise<DoraResult[]> {
    const { ctx, kind } = await this.sources.resolveContext(sourceId);
    const connector = this.connectors.for(kind);
    const since = await this.windowStart();
    const repos = await connector.listRepositories(ctx);

    // Best-effort: a missing permission on one endpoint yields partial metrics
    // rather than failing the whole computation.
    const [deployments, mergedPrs] = await Promise.all([
      connector.listDeployments(ctx, repos).catch((e) => {
        this.logger.warn(`listDeployments échoué (${sourceId}) : ${asMessage(e)}`);
        return [] as Deployment[];
      }),
      connector.listMergedPullRequests(ctx, repos, since).catch((e) => {
        this.logger.warn(`listMergedPullRequests échoué (${sourceId}) : ${asMessage(e)}`);
        return [] as MergedPullRequest[];
      }),
    ]);

    const deploymentEvents = await this.toDeploymentEvents(sourceId, deployments, since);
    const prEvents = mergedPrs.map(toMergedPrEvent);

    return [
      ...deploymentFrequency(deploymentEvents),
      ...changeFailureRate(deploymentEvents),
      ...mttr(deploymentEvents),
      ...leadTimeBreakdown(prEvents),
    ];
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

  private async windowStart(): Promise<string> {
    const { doraWindowDays } = await this.settings.get();
    return new Date(Date.now() - doraWindowDays * 86_400_000).toISOString();
  }

  private async toDeploymentEvents(
    sourceId: string,
    deployments: Deployment[],
    since: string,
  ): Promise<DeploymentEvent[]> {
    const sinceMs = new Date(since).getTime();
    const inWindow = deployments.filter((d) => new Date(d.createdAt).getTime() >= sinceMs);

    // Classify each distinct environment name once.
    const dimensionsByEnv = new Map<string, Record<string, string>>();
    for (const name of new Set(inWindow.map((d) => d.environment))) {
      const classified = await this.envRules.classify(sourceId, name);
      dimensionsByEnv.set(name, classified.attributes);
    }

    return inWindow.map((d) => ({
      environment: d.environment,
      repo: d.repo,
      status: toEventStatus(d.status),
      createdAt: d.createdAt,
      dimensions: dimensionsByEnv.get(d.environment) ?? {},
    }));
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toEventStatus(status: PipelineStatus): DeploymentEvent['status'] {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  return 'other';
}

function toMergedPrEvent(pr: MergedPullRequest): MergedPrEvent {
  return {
    repo: pr.repo,
    number: pr.number,
    url: pr.url,
    firstCommitAt: pr.firstCommitAt,
    openedAt: pr.openedAt,
    firstReviewAt: pr.firstReviewAt,
    mergedAt: pr.mergedAt,
    dimensions: {},
  };
}
