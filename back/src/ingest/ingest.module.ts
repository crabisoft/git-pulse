import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SourcesModule } from '../sources/sources.module';
import { SettingsModule } from '../settings/settings.module';
import { CoverageController } from './coverage.controller';
import { CoverageService } from './coverage.service';
import { ReaderFactory } from './reader.factory';
import { RetentionService } from './retention.service';
import { StoreService } from './store.service';
import { SyncService } from './sync.service';
import { WebhookController } from './webhooks/webhook.controller';
import { WebhookService } from './webhooks/webhook.service';
import { IngestProcessor } from './webhooks/ingest.processor';

/**
 * Everything that fills the read model and reads it back.
 *
 * Deliberately unaware of the sources module beyond what a reader needs: the
 * dependency runs one way, so a source can enqueue ingestion work without this
 * module and that one importing each other.
 *
 * The queue is its own rather than the collection's: events arrive in bursts and
 * must not queue behind a synchronisation that takes minutes.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'ingest' }),
    SourcesModule,
    SettingsModule,
  ],
  controllers: [WebhookController, CoverageController],
  providers: [
    StoreService,
    ReaderFactory,
    SyncService,
    RetentionService,
    CoverageService,
    WebhookService,
    IngestProcessor,
  ],
  exports: [StoreService, ReaderFactory, SyncService, RetentionService, CoverageService],
})
export class IngestModule {}
