import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Kept beyond the reporting window rather than exactly up to it.
 *
 * The window is a setting, and widening it must not read as data loss: a month
 * asked for the day after a fortnight was configured should find something
 * there. A week costs little and covers the change of mind.
 */
const RETENTION_MARGIN_DAYS = 7;

/**
 * How long a delivery is remembered.
 *
 * Only long enough to recognise a repeat — providers give up retrying in hours,
 * not days. Anything beyond that is a table growing for no reader.
 */
const DELIVERY_RETENTION_DAYS = 7;

const DAY_MS = 86_400_000;

/** What one sweep removed. */
export interface PruneOutcome {
  pipelines: number;
  deployments: number;
  pullRequests: number;
  deliveries: number;
}

/**
 * Keeps the store bounded.
 *
 * The ingestion writes for as long as an install runs, and nothing it writes
 * expires on its own — a pipeline from last spring is still a row. What decides
 * is the reporting window: below it, nothing reads a row again.
 *
 * Open pull requests are the exception, and deliberately: one opened two years
 * ago and never merged is not stale data, it is the very thing the stale-PR
 * tile exists to show.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async prune(now: Date = new Date()): Promise<PruneOutcome> {
    const { doraWindowDays } = await this.settings.get();
    const cutoff = new Date(now.getTime() - (doraWindowDays + RETENTION_MARGIN_DAYS) * DAY_MS);
    const deliveryCutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * DAY_MS);

    const [pipelines, deployments, pullRequests, deliveries] = await this.prisma.$transaction([
      this.prisma.storedPipeline.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      this.prisma.storedDeployment.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      this.prisma.storedPullRequest.deleteMany({
        where: { state: { notIn: ['open', 'draft'] }, updatedAt: { lt: cutoff } },
      }),
      this.prisma.webhookDelivery.deleteMany({ where: { receivedAt: { lt: deliveryCutoff } } }),
    ]);

    const outcome = {
      pipelines: pipelines.count,
      deployments: deployments.count,
      pullRequests: pullRequests.count,
      deliveries: deliveries.count,
    };
    const removed = Object.values(outcome).reduce((a, b) => a + b, 0);
    if (removed > 0) {
      this.logger.log(
        `Purge du magasin : ${outcome.pipelines} pipeline(s), ${outcome.deployments} déploiement(s), ` +
          `${outcome.pullRequests} PR close(s), ${outcome.deliveries} livraison(s).`,
      );
    }
    return outcome;
  }
}
