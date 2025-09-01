import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { CollectorService } from './collector.service';
import { SourcesService } from '../sources/sources.service';

/**
 * Worker for the collection queue.
 * - collect-all   : fan out one collect-source job per source.
 * - collect-source: snapshot metrics for a single source.
 */
@Processor('collection')
export class CollectionProcessor extends WorkerHost {
  private readonly logger = new Logger(CollectionProcessor.name);

  constructor(
    private readonly collector: CollectorService,
    private readonly sources: SourcesService,
    @InjectQueue('collection') private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'collect-all') {
      const sourceIds = await this.sources.listIds();
      await Promise.all(sourceIds.map((sourceId) => this.queue.add('collect-source', { sourceId })));
      return { enqueued: sourceIds.length };
    }

    if (job.name === 'collect-source') {
      const { sourceId } = job.data as { sourceId: string };
      const snapshots = await this.collector.collectSource(sourceId);
      return { sourceId, count: snapshots.length };
    }

    this.logger.warn(`Job inconnu ignoré : ${job.name}`);
    return null;
  }
}
