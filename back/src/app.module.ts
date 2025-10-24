import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './crypto/crypto.module';
import { SourcesModule } from './sources/sources.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EnvRulesModule } from './env-rules/env-rules.module';
import { TrackersModule } from './trackers/trackers.module';
import { TicketRulesModule } from './ticket-rules/ticket-rules.module';
import { ReleaseNotesModule } from './release-notes/release-notes.module';
import { DoraModule } from './dora/dora.module';
import { CollectionModule } from './collection/collection.module';
import { ApiQuotaModule } from './api-quota/api-quota.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SettingsModule,
    AuthModule,
    CryptoModule,
    SourcesModule,
    DashboardModule,
    EnvRulesModule,
    TrackersModule,
    TicketRulesModule,
    ReleaseNotesModule,
    DoraModule,
    CollectionModule,
    ApiQuotaModule,
  ],
})
export class AppModule {}
