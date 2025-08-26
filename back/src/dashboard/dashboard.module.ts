import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SourcesModule } from '../sources/sources.module';
import { EnvRulesModule } from '../env-rules/env-rules.module';

@Module({
  imports: [SourcesModule, EnvRulesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
