import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { EnvRulesService } from './env-rules.service';
import { PaginationQueryDto, toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { CreateEnvRuleDto } from './dto/create-env-rule.dto';
import { UpdateEnvRuleDto } from './dto/update-env-rule.dto';
import { PreviewEnvRulesDto } from './dto/preview-env-rules.dto';
import { classifyEnvironment } from './env-classifier';

@Controller()
export class EnvRulesController {
  constructor(
    private readonly envRules: EnvRulesService,
    private readonly settings: SettingsService,
  ) {}

  @Get('sources/:sourceId/env-rules')
  async list(@Param('sourceId') sourceId: string, @Query() query: PaginationQueryDto) {
    return this.envRules.findBySource(sourceId, toWindow(query, await this.settings.pageSize()));
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
    );
  }
}
