import { Module } from '@nestjs/common';
import { EnvRulesService } from './env-rules.service';
import { EnvRulesController } from './env-rules.controller';

@Module({
  controllers: [EnvRulesController],
  providers: [EnvRulesService],
  exports: [EnvRulesService],
})
export class EnvRulesModule {}
