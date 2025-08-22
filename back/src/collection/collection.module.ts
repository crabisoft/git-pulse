import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CollectorService } from './collector.service';
import { CollectionProcessor } from './collection.processor';
import { CollectionScheduler } from './collection.scheduler';
import { CollectionController } from './collection.controller';
import { SourcesModule } from '../sources/sources.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DoraModule } from '../dora/dora.module';
import { redisConnection } from './redis.util';

@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: 'collection' }),
    SourcesModule,
    DashboardModule,
    DoraModule,
  ],
  controllers: [CollectionController],
  providers: [CollectorService, CollectionProcessor, CollectionScheduler],
  exports: [CollectorService],
})
export class CollectionModule {}
