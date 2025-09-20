import { Module } from '@nestjs/common';
import { DoraService } from './dora.service';
import { DoraController } from './dora.controller';
import { SourcesModule } from '../sources/sources.module';
import { EnvRulesModule } from '../env-rules/env-rules.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { TrackersModule } from '../trackers/trackers.module';
import { TicketRulesModule } from '../ticket-rules/ticket-rules.module';

@Module({
  imports: [SourcesModule, EnvRulesModule, IncidentsModule, TrackersModule, TicketRulesModule],
  controllers: [DoraController],
  providers: [DoraService],
  exports: [DoraService],
})
export class DoraModule {}
