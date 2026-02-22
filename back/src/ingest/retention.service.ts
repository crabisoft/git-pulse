import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { depthDays } from './sync-cadence';

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
 * is how deep each source is ingested: below that, nothing reads a row again.
 *
 * Per source rather than per install, because the depth is: sweeping every
 * source at the shallowest of them would delete, hours later, precisely the
 * history a source was configured to keep — and the next reconciliation would
 * fetch it all back, for ever.
 *
 * On its own schedule rather than at the end of every collection, and with a
 * margin that is a setting: the two used to share the collection's cadence,
 * which meant a depth widened at noon was raced by a sweep at the old one a
 * quarter of an hour later. What it deletes follows the depths, so it has no
 * reason to run more often than those change.
 *
 * Open pull requests are the exception, and deliberately: one opened two years
 * ago and never merged is not stale data, it is the very thing the stale-PR
 * tile exists to show.
 *
 * `DeploymentChangelog` is not swept here either, and for a stronger reason:
 * every table below can be refetched from the provider if it were dropped, and
 * that one cannot — it is what a deployment carried, written down because the
 * environment it went to no longer exists to be asked.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async prune(now: Date = new Date()): Promise<PruneOutcome> {
    const { doraWindowDays, retentionMarginDays } = await this.settings.get();
    const sources = await this.prisma.source.findMany({ select: { id: true, historyDays: true } });
    const deliveryCutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * DAY_MS);

    const sweeps = sources.map((source) => {
      const days = depthDays(source.historyDays, doraWindowDays) + retentionMarginDays;
      const cutoff = new Date(now.getTime() - days * DAY_MS);
      return { sourceId: source.id, cutoff };
    });

    const results = await this.prisma.$transaction([
      ...sweeps.flatMap(({ sourceId, cutoff }) => [
        this.prisma.storedPipeline.deleteMany({ where: { sourceId, createdAt: { lt: cutoff } } }),
        this.prisma.storedDeployment.deleteMany({ where: { sourceId, createdAt: { lt: cutoff } } }),
        this.prisma.storedPullRequest.deleteMany({
          where: { sourceId, state: { notIn: ['open', 'draft'] }, updatedAt: { lt: cutoff } },
        }),
      ]),
      this.prisma.webhookDelivery.deleteMany({ where: { receivedAt: { lt: deliveryCutoff } } }),
    ]);

    // Three deletions per source, in the order they were queued, then the
    // deliveries — which are swept per install, having no depth of their own.
    const deliveries = results[results.length - 1];
    const counted = (offset: number) =>
      sweeps.reduce((total, _, i) => total + results[i * 3 + offset].count, 0);
    const outcome = {
      pipelines: counted(0),
      deployments: counted(1),
      pullRequests: counted(2),
      deliveries: deliveries.count,
    };
    const removed = Object.values(outcome).reduce((a, b) => a + b, 0);
    if (removed > 0) {
      this.logger.log(
        `Store swept: ${outcome.pipelines} pipeline(s), ${outcome.deployments} deployment(s), ` +
          `${outcome.pullRequests} closed PR(s), ${outcome.deliveries} delivery record(s).`,
      );
    }
    return outcome;
  }
}
