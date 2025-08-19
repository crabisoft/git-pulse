import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

const DEFAULT_CRON = '*/15 * * * *';

/** Registers the repeatable collect-all job on startup. */
@Injectable()
export class CollectionScheduler implements OnModuleInit {
  private readonly logger = new Logger(CollectionScheduler.name);

  constructor(@InjectQueue('collection') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    const pattern = process.env.COLLECT_CRON ?? DEFAULT_CRON;
    // No custom jobId: BullMQ forbids it on repeatable jobs and dedupes by the
    // repeat key (name + pattern), so restarts don't stack schedules.
    await this.queue.add(
      'collect-all',
      {},
      { repeat: { pattern }, removeOnComplete: true, removeOnFail: 100 },
    );
    this.logger.log(`Collecte planifiée (cron "${pattern}").`);
  }
}
