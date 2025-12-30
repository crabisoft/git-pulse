import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SettingsService } from '../settings/settings.service';
import { JOB_HISTORY } from '../common/job-options';

const JOB_NAME = 'collect-all';

/** Registers the repeatable collect-all job and keeps it in sync with the settings. */
@Injectable()
export class CollectionScheduler implements OnModuleInit {
  private readonly logger = new Logger(CollectionScheduler.name);

  constructor(
    @InjectQueue('collection') private readonly queue: Queue,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { collectCron } = await this.settings.get();
    await this.schedule(collectCron);
    this.settings.onChange((s) => {
      void this.schedule(s.collectCron).catch((e) => {
        this.logger.error(`Replanification de la collecte échouée : ${asMessage(e)}`);
      });
    });
  }

  /** Drops the schedules on other patterns, then registers the job on this one. */
  private async schedule(pattern: string): Promise<void> {
    for (const job of await this.queue.getRepeatableJobs()) {
      if (job.name === JOB_NAME && job.pattern !== pattern) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }
    // No custom jobId: BullMQ forbids it on repeatable jobs and dedupes by the
    // repeat key (name + pattern), so restarts don't stack schedules.
    //
    // No retry either, unlike the jobs it fans out: the cron brings this one
    // back on its own, and a second attempt would enqueue the whole fan-out
    // twice over.
    await this.queue.add(JOB_NAME, {}, { repeat: { pattern }, ...JOB_HISTORY });
    this.logger.log(`Collecte planifiée (cron "${pattern}").`);
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
