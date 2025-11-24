import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CollectorService } from './collector.service';
import { CollectionProcessor } from './collection.processor';
import { CollectionScheduler } from './collection.scheduler';
import { CollectionController } from './collection.controller';
import { SourcesModule } from '../sources/sources.module';
import { IngestModule } from '../ingest/ingest.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DoraModule } from '../dora/dora.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'collection' }),
    SourcesModule,
    IngestModule,
    DashboardModule,
    DoraModule,
  ],
  controllers: [CollectionController],
  providers: [CollectorService, CollectionProcessor, CollectionScheduler],
  exports: [CollectorService],
})
export class CollectionModule {}
