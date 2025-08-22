import { Module } from '@nestjs/common';
import { DoraService } from './dora.service';
import { DoraController } from './dora.controller';
import { SourcesModule } from '../sources/sources.module';
import { EnvRulesModule } from '../env-rules/env-rules.module';

@Module({
  imports: [SourcesModule, EnvRulesModule],
  controllers: [DoraController],
  providers: [DoraService],
  exports: [DoraService],
})
export class DoraModule {}
