import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VersionRulesService } from './version-rules.service';
import { VersionReadingsService } from './version-readings.service';
import { VersionRulesController } from './version-rules.controller';
import { VersionProbeProcessor } from './version-probe.processor';
import { VersionReadingStoreModule } from './version-reading-store.module';
import { PROBE_QUEUE } from './probe-job';
import { CryptoModule } from '../crypto/crypto.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { EnvUrlsModule } from '../env-urls/env-urls.module';

/**
 * The queue is registered here, where it is consumed. The ingestion registers
 * it too, to put work on it — a queue name is all that passes between them,
 * which is what keeps the dependency from running both ways: this module needs
 * the deployments module, and that one needs the ingestion.
 */
@Module({
  imports: [
    CryptoModule,
    DeploymentsModule,
    EnvUrlsModule,
    VersionReadingStoreModule,
    BullModule.registerQueue({ name: PROBE_QUEUE }),
  ],
  controllers: [VersionRulesController],
  providers: [VersionRulesService, VersionReadingsService, VersionProbeProcessor],
  exports: [VersionRulesService, VersionReadingsService],
})
export class VersionRulesModule {}
