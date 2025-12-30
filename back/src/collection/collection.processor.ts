import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { CollectorService } from './collector.service';
import { SourcesService } from '../sources/sources.service';
import { RetentionService } from '../ingest/retention.service';
import { JOB_DEFAULTS } from '../common/job-options';

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
    private readonly retention: RetentionService,
    @InjectQueue('collection') private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'collect-all') {
      const sourceIds = await this.sources.listIds();
      await Promise.all(
        sourceIds.map((sourceId) => this.queue.add('collect-source', { sourceId }, JOB_DEFAULTS)),
      );
      // Once per cycle rather than per source: what it removes is bounded by
      // the reporting window, which is one setting for the whole install.
      // Best-effort — a store growing a cycle longer beats a collection that
      // did not run.
      const pruned = await this.retention.prune().catch((e) => {
        this.logger.warn(`Purge du magasin échouée : ${asMessage(e)}`);
        return null;
      });
      return { enqueued: sourceIds.length, pruned };
    }

    if (job.name === 'collect-source') {
      const { sourceId } = job.data as { sourceId: string };
      // Returned rather than swallowed: the collector catches its best-effort
      // steps so a snapshot is still written, which would otherwise complete
      // this job green over a source whose ingestion failed outright.
      const { snapshots, warnings } = await this.collector.collect(sourceId);
      return { sourceId, count: snapshots.length, warnings };
    }

    this.logger.warn(`Job inconnu ignoré : ${job.name}`);
    return null;
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
