import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { EnvRulesService } from './env-rules.service';
import { toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { CreateEnvRuleDto } from './dto/create-env-rule.dto';
import { UpdateEnvRuleDto } from './dto/update-env-rule.dto';
import { PreviewEnvRulesDto } from './dto/preview-env-rules.dto';
import { ListEnvRulesDto } from './dto/list-env-rules.dto';
import { ClassifyNameDto } from './dto/classify-name.dto';
import { classifyEnvironment } from './env-classifier';

@Controller()
export class EnvRulesController {
  constructor(
    private readonly envRules: EnvRulesService,
    private readonly settings: SettingsService,
  ) {}

  /** The whole catalogue: rules are global, sources opt into them. */
  @Get('env-rules')
  async list(@Query() query: ListEnvRulesDto) {
    return this.envRules.findAll(
      query.target ?? 'environment',
      toWindow(query, await this.settings.pageSize()),
    );
  }

  @Post('env-rules')
  create(@Body() dto: CreateEnvRuleDto) {
    return this.envRules.create(dto);
  }

  /** Classifies against the rules a given source opted into. */
  @Post('sources/:sourceId/env-rules/classify')
  @HttpCode(200)
  classify(@Param('sourceId') sourceId: string, @Body() dto: ClassifyNameDto) {
    return this.envRules.classify(
      sourceId,
      { name: dto.name, repo: dto.repo || undefined },
      dto.target ?? 'environment',
    );
  }

  @Patch('env-rules/:id')
  update(@Param('id') id: string, @Body() dto: UpdateEnvRuleDto) {
    return this.envRules.update(id, dto);
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
      { repo: dto.repo || undefined },
    );
  }
}
