import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { SourcesModule } from './sources/sources.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EnvRulesModule } from './env-rules/env-rules.module';
import { CollectionModule } from './collection/collection.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CryptoModule,
    SourcesModule,
    DashboardModule,
    EnvRulesModule,
    CollectionModule,
  ],
})
export class AppModule {}
