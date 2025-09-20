import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { CryptoModule } from './crypto/crypto.module';
import { SourcesModule } from './sources/sources.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EnvRulesModule } from './env-rules/env-rules.module';
import { TrackersModule } from './trackers/trackers.module';
import { TicketRulesModule } from './ticket-rules/ticket-rules.module';
import { DoraModule } from './dora/dora.module';
import { CollectionModule } from './collection/collection.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SettingsModule,
    CryptoModule,
    SourcesModule,
    DashboardModule,
    EnvRulesModule,
    TrackersModule,
    TicketRulesModule,
    DoraModule,
    CollectionModule,
  ],
})
export class AppModule {}
