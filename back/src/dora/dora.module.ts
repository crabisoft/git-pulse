import { Module } from '@nestjs/common';
import { DoraService } from './dora.service';
import { DoraController } from './dora.controller';
import { SourcesModule } from '../sources/sources.module';
import { EnvRulesModule } from '../env-rules/env-rules.module';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [SourcesModule, EnvRulesModule, IncidentsModule],
  controllers: [DoraController],
  providers: [DoraService],
  exports: [DoraService],
})
export class DoraModule {}
