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
import { PROBE_QUEUE } from '../version-rules/probe-job';

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
    // Written to, never consumed here: an event that lands a deployment asks
    // for a reading, and the module that takes readings depends on this one.
    // A queue name is the only thing that crosses, so the dependency stays
    // one-way.
    BullModule.registerQueue({ name: PROBE_QUEUE }),
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
