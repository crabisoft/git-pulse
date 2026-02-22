import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SettingsService } from '../settings/settings.service';
import { JOB_HISTORY } from '../common/job-options';

const COLLECT_JOB = 'collect-all';
const PRUNE_JOB = 'prune-store';

/**
 * Registers the repeatable jobs of the collection queue and keeps them in sync
 * with the settings.
 *
 * Two schedules rather than one, and that is the point: the collection runs at
 * whatever cadence freshness asks for, while the purge deletes by each source's
 * depth and has no reason to run more often than those change. They shared a
 * schedule until the depth became a per-source setting, at which point a widened
 * depth was raced by a sweep at the old one minutes later.
 */
@Injectable()
export class CollectionScheduler implements OnModuleInit {
  private readonly logger = new Logger(CollectionScheduler.name);

  constructor(
    @InjectQueue('collection') private readonly queue: Queue,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { collectCron, pruneCron } = await this.settings.get();
    await this.schedule(COLLECT_JOB, collectCron);
    await this.schedule(PRUNE_JOB, pruneCron);
    this.settings.onChange((s) => {
      void Promise.all([
        this.schedule(COLLECT_JOB, s.collectCron),
        this.schedule(PRUNE_JOB, s.pruneCron),
      ]).catch((e) => {
        this.logger.error(`Rescheduling failed: ${asMessage(e)}`);
      });
    });
  }

  /** Drops the schedules on other patterns, then registers the job on this one. */
  private async schedule(name: string, pattern: string): Promise<void> {
    for (const job of await this.queue.getRepeatableJobs()) {
      if (job.name === name && job.pattern !== pattern) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }
    // No custom jobId: BullMQ forbids it on repeatable jobs and dedupes by the
    // repeat key (name + pattern), so restarts don't stack schedules.
    //
    // No retry either, unlike the jobs it fans out: the cron brings this one
    // back on its own, and a second attempt would enqueue the whole fan-out
    // twice over.
    await this.queue.add(name, {}, { repeat: { pattern }, ...JOB_HISTORY });
    this.logger.log(`Job "${name}" scheduled (cron "${pattern}").`);
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
