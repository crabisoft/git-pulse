import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';

/**
 * Registers both queues rather than owning either: the modules that produce the
 * work keep their own registration, and this one only takes a handle on them by
 * name. A second handle is a second client on the same Redis keys, not a second
 * queue — reading a queue is not a reason to make the module that fills it
 * depend on this one, nor the other way round.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'collection' }, { name: 'ingest' }),
  ],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
