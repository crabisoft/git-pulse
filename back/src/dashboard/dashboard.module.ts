import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { IngestModule } from '../ingest/ingest.module';
import { EnvRulesModule } from '../env-rules/env-rules.module';
import { EnvUrlsModule } from '../env-urls/env-urls.module';
import { TicketRulesModule } from '../ticket-rules/ticket-rules.module';

@Module({
  imports: [IngestModule, EnvRulesModule, EnvUrlsModule, TicketRulesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
