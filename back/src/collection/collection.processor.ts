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
 * - prune-store   : sweep each source's store down to its own depth.
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
      return { enqueued: sourceIds.length };
    }

    if (job.name === 'prune-store') {
      // A job of its own rather than the tail of the fan-out above: it deletes
      // by each source's depth, and has no reason to run at the cadence
      // freshness asks the collection for. Thrown rather than swallowed — this
      // one has nothing else to protect, and a purge that stopped working is
      // exactly what the failures page is for.
      return this.retention.prune();
    }

    if (job.name === 'collect-source') {
      // `force` travels in the data rather than in a job name of its own: what
      // it changes is how deep this run reads, not what it does — and a second
      // name would have to be handled everywhere this one already is.
      const { sourceId, force } = job.data as { sourceId: string; force?: boolean };
      // Returned rather than swallowed: the collector catches its best-effort
      // steps so a snapshot is still written, which would otherwise complete
      // this job green over a source whose ingestion failed outright.
      const { snapshots, warnings } = await this.collector.collect(sourceId, { force });
      return { sourceId, count: snapshots.length, warnings };
    }

    this.logger.warn(`Job inconnu ignoré : ${job.name}`);
    return null;
  }
}
