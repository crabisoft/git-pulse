import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { StoreService } from '../store.service';
import { PROBE_QUEUE, enqueueProbe } from '../../version-rules/probe-job';
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

  constructor(
    private readonly store: StoreService,
    @InjectQueue(PROBE_QUEUE) private readonly probes: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== 'ingest-event') {
      this.logger.warn(`Unknown job ignored: ${job.name}`);
      return null;
    }

    const { sourceId, intent } = job.data as { sourceId: string; intent: IngestIntent };
    const seenAt = new Date();
    switch (intent.kind) {
      case 'pull-request':
        return { written: await this.store.upsertPullRequests(sourceId, [intent.item], seenAt) };
      case 'pipeline':
        return { written: await this.store.upsertPipelines(sourceId, [intent.item], seenAt) };
      case 'deployment': {
        const written = await this.store.upsertDeployments(sourceId, [intent.item], seenAt);
        return { written, probe: await this.askForReading(sourceId, intent.item) };
      }
      default:
        return null;
    }
  }

  /**
   * Asks for a reading of the environment this deployment just reached.
   *
   * **Successful deployments only**, the same line the changelog archiver
   * draws: a failed or running one has put nothing on the environment, so a
   * version read against it would describe what was already there and freeze it
   * against the wrong deployment.
   *
   * Queued rather than read here: it has to wait out a settling delay, and an
   * ingestion worker asleep for half a minute is an ingestion worker not
   * writing the rest of the burst. Deduplicated on the environment — a single
   * deployment emits several status events — see `enqueueProbe`.
   *
   * Best-effort on purpose. A queue that will not take the job must not fail
   * the write that has already happened: the scheduled probe reads this
   * environment within the interval anyway, which is the whole reason both
   * paths exist.
   */
  private async askForReading(
    sourceId: string,
    deployment: { repo: string; environment: string; status: string },
  ): Promise<boolean> {
    if (deployment.status !== 'success') return false;
    try {
      return await enqueueProbe(this.probes, {
        sourceId,
        repo: deployment.repo,
        environment: deployment.environment,
      });
    } catch (e) {
      this.logger.warn(
        `Could not queue a version reading for ${deployment.repo}/${deployment.environment}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return false;
    }
  }
}
