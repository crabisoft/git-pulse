import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SourcesModule } from '../sources/sources.module';
import { EnvRulesModule } from '../env-rules/env-rules.module';
import { TicketRulesModule } from '../ticket-rules/ticket-rules.module';

@Module({
  imports: [SourcesModule, EnvRulesModule, TicketRulesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
