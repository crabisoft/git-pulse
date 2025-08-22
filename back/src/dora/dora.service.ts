import { Injectable } from '@nestjs/common';
import type { Deployment, DoraResult, MergedPullRequest, PipelineStatus } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SourcesService } from '../sources/sources.service';
import { ConnectorFactory } from '../sources/connectors/connector.factory';
import { EnvRulesService } from '../env-rules/env-rules.service';
import {
  deploymentFrequency,
  changeFailureRate,
  mttr,
  leadTimeBreakdown,
  type DeploymentEvent,
  type MergedPrEvent,
} from './dora-metrics';

const DEFAULT_WINDOW_DAYS = 30;

@Injectable()
export class DoraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly connectors: ConnectorFactory,
    private readonly envRules: EnvRulesService,
  ) {}

  /** Compute DORA metrics over the lookback window for a source. */
  async compute(sourceId: string): Promise<DoraResult[]> {
    const { ctx, kind } = await this.sources.resolveContext(sourceId);
    const connector = this.connectors.for(kind);
    const since = this.windowStart();
    const repos = await connector.listRepositories(ctx);

    const [deployments, mergedPrs] = await Promise.all([
      connector.listDeployments(ctx, repos),
      connector.listMergedPullRequests(ctx, repos, since),
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

  private windowStart(): string {
    const days = Number(process.env.DORA_WINDOW_DAYS ?? DEFAULT_WINDOW_DAYS);
    return new Date(Date.now() - days * 86_400_000).toISOString();
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
      status: toEventStatus(d.status),
      createdAt: d.createdAt,
      dimensions: dimensionsByEnv.get(d.environment) ?? {},
    }));
  }
}

function toEventStatus(status: PipelineStatus): DeploymentEvent['status'] {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  return 'other';
}

function toMergedPrEvent(pr: MergedPullRequest): MergedPrEvent {
  return {
    firstCommitAt: pr.firstCommitAt,
    openedAt: pr.openedAt,
    firstReviewAt: pr.firstReviewAt,
    mergedAt: pr.mergedAt,
    dimensions: {},
  };
}
