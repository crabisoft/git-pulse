import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { EnvRulesService } from './env-rules.service';
import { CreateEnvRuleDto } from './dto/create-env-rule.dto';
import { PreviewEnvRulesDto } from './dto/preview-env-rules.dto';
import { classifyEnvironment } from './env-classifier';

@Controller()
export class EnvRulesController {
  constructor(private readonly envRules: EnvRulesService) {}

  @Get('sources/:sourceId/env-rules')
  list(@Param('sourceId') sourceId: string) {
    return this.envRules.findBySource(sourceId);
  }

  @Post('sources/:sourceId/env-rules')
  create(@Param('sourceId') sourceId: string, @Body() dto: CreateEnvRuleDto) {
    return this.envRules.create(sourceId, dto);
  }

  @Post('sources/:sourceId/env-rules/classify')
  @HttpCode(200)
  classify(@Param('sourceId') sourceId: string, @Body('name') name: string) {
    return this.envRules.classify(sourceId, name);
  }

  @Delete('env-rules/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.envRules.remove(id);
  }

  /** Stateless preview: classify a name against a candidate rule set. */
  @Post('env-rules/preview')
  @HttpCode(200)
  preview(@Body() dto: PreviewEnvRulesDto) {
    return classifyEnvironment(
      dto.name,
      dto.rules.map((r) => ({ ...r, priority: r.priority ?? 100 })),
    );
  }
}
