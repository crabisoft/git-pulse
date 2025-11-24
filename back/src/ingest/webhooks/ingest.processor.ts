import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StoreService } from '../store.service';
import type { IngestIntent } from './events';

/**
 * Writes what an event asked for.
 *
 * On its own queue rather than sharing the collection's: a busy afternoon
 * delivers events by the hundred, and they must not sit behind a
 * synchronisation that takes minutes — nor push one out of the way.
 *
 * Everything it writes goes through the same merge rules as a synchronisation,
 * so an event arriving late, twice, or out of order changes nothing a
 * synchronisation would not have settled anyway.
 */
@Processor('ingest')
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(private readonly store: StoreService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== 'ingest-event') {
      this.logger.warn(`Job inconnu ignoré : ${job.name}`);
      return null;
    }

    const { sourceId, intent } = job.data as { sourceId: string; intent: IngestIntent };
    const seenAt = new Date();
    switch (intent.kind) {
      case 'pull-request':
        return { written: await this.store.upsertPullRequests(sourceId, [intent.item], seenAt) };
      case 'pipeline':
        return { written: await this.store.upsertPipelines(sourceId, [intent.item], seenAt) };
      case 'deployment':
        return { written: await this.store.upsertDeployments(sourceId, [intent.item], seenAt) };
      default:
        return null;
    }
  }
}
