import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { redisConnection } from './common/redis.util';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './crypto/crypto.module';
import { SourcesModule } from './sources/sources.module';
import { IngestModule } from './ingest/ingest.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EnvRulesModule } from './env-rules/env-rules.module';
import { EnvUrlsModule } from './env-urls/env-urls.module';
import { VersionRulesModule } from './version-rules/version-rules.module';
import { TrackersModule } from './trackers/trackers.module';
import { TicketRulesModule } from './ticket-rules/ticket-rules.module';
import { ReleaseNotesModule } from './release-notes/release-notes.module';
import { LlmModule } from './llm/llm.module';
import { DoraModule } from './dora/dora.module';
import { DeploymentsModule } from './deployments/deployments.module';
import { ChangelogsModule } from './changelogs/changelogs.module';
import { CollectionModule } from './collection/collection.module';
import { ApiQuotaModule } from './api-quota/api-quota.module';
import { JobsModule } from './jobs/jobs.module';
import { OverviewModule } from './overview/overview.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Declared here rather than in the module that first needed a queue: two
    // modules now register one, and neither should have to know which of them
    // happens to configure the connection.
    BullModule.forRoot({ connection: redisConnection() }),
    PrismaModule,
    SettingsModule,
    AuthModule,
    CryptoModule,
    SourcesModule,
    IngestModule,
    DashboardModule,
    EnvRulesModule,
    EnvUrlsModule,
    VersionRulesModule,
    TrackersModule,
    TicketRulesModule,
    LlmModule,
    ReleaseNotesModule,
    DoraModule,
    DeploymentsModule,
    ChangelogsModule,
    CollectionModule,
    ApiQuotaModule,
    JobsModule,
    OverviewModule,
  ],
})
export class AppModule {}
