import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { VersionReadingsService, PROBE_RETRY_ATTEMPTS } from './version-readings.service';
import { PROBE_JOB, PROBE_QUEUE, enqueueProbe, type ProbeJobData } from './probe-job';

/**
 * Reads an environment because something was just deployed to it.
 *
 * On its own queue, and bounded to the same handful of parallel readings the
 * collection allows itself: fifty deployments landing at once is a normal
 * afternoon on a busy install, and fifty simultaneous connections into
 * customers' applications is not something any of them agreed to. The queue is
 * what turns the burst into a line.
 *
 * The scheduled probe is untouched by any of this. It reads what is due, and
 * an environment read by an event a minute ago is not due — the interval that
 * was already there is what keeps the two paths from doing each other's work,
 * so a source with no webhook behaves exactly as it did before.
 */
@Processor(PROBE_QUEUE, { concurrency: 4 })
export class VersionProbeProcessor extends WorkerHost {
  private readonly logger = new Logger(VersionProbeProcessor.name);

  constructor(
    private readonly readings: VersionReadingsService,
    @InjectQueue(PROBE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== PROBE_JOB) {
      this.logger.warn(`Unknown job ignored: ${job.name}`);
      return null;
    }

    const data = job.data as ProbeJobData;
    const attempt = data.attempt ?? 1;
    const outcome = await this.readings.probeDeployment(data.sourceId, data.repo, data.environment);

    /**
     * One more reading, and only one.
     *
     * An environment still answering what it answered before usually means it
     * had not finished restarting when the settling delay ran out. It can also
     * mean the same version was deployed again, which is perfectly legitimate —
     * the two are indistinguishable from here, which is exactly why this stops
     * after the second attempt instead of waiting for a change that may never
     * come. Whatever was read has already been filed either way.
     */
    if (outcome.read && !outcome.changed && attempt < PROBE_RETRY_ATTEMPTS) {
      await enqueueProbe(this.queue, { ...data, attempt: attempt + 1 });
      return { ...outcome, retried: true };
    }
    return { ...outcome, retried: false };
  }
}
