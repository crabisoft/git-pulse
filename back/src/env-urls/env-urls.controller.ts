import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { EnvUrlsService } from './env-urls.service';
import { toWindow, PaginationQueryDto } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { resolveEnvUrl } from './env-url';
import { CreateEnvUrlRuleDto } from './dto/create-env-url-rule.dto';
import { UpdateEnvUrlRuleDto } from './dto/update-env-url-rule.dto';
import { CreateManualEnvironmentDto } from './dto/create-manual-environment.dto';
import { UpdateManualEnvironmentDto } from './dto/update-manual-environment.dto';
import { PreviewEnvUrlDto } from './dto/preview-env-url.dto';

@Controller()
export class EnvUrlsController {
  constructor(
    private readonly envUrls: EnvUrlsService,
    private readonly settings: SettingsService,
  ) {}

  /** The whole catalogue: rules are global, sources opt into them. */
  @Get('env-url-rules')
  async listRules(@Query() query: PaginationQueryDto) {
    return this.envUrls.findRules(toWindow(query, await this.settings.pageSize()));
  }

  @Post('env-url-rules')
  createRule(@Body() dto: CreateEnvUrlRuleDto) {
    return this.envUrls.createRule(dto);
  }

  @Patch('env-url-rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateEnvUrlRuleDto) {
    return this.envUrls.updateRule(id, dto);
  }

  @Delete('env-url-rules/:id')
  @HttpCode(204)
  removeRule(@Param('id') id: string) {
    return this.envUrls.removeRule(id);
  }

  /**
   * Stateless preview: what a candidate rule would make of one environment.
   *
   * Worth its own route because the answer is otherwise invisible until a
   * collection runs — and an address that comes out wrong is indistinguishable
   * from a platform that published none.
   */
  @Post('env-url-rules/preview')
  @HttpCode(200)
  preview(@Body() dto: PreviewEnvUrlDto) {
    // Resolved rather than merely addressed: a null answer has two causes that
    // look alike on a page — nothing claimed this environment, or something did
    // and its template named what does not resolve — and only the second is
    // fixed by touching the template. Saying which is the whole point of a
    // preview.
    const resolution = resolveEnvUrl(
      {
        repo: dto.repo ?? '',
        environment: dto.environment,
        ref: dto.ref,
        environmentUrl: dto.environmentUrl,
        attributes: dto.attributes,
      },
      dto.rules.map((rule) => ({ ...rule, mode: rule.mode ?? 'fill', priority: rule.priority ?? 100 })),
    );
    return { ...resolution, published: dto.environmentUrl ?? null };
  }

  /** Declared environments belong to a source, unlike the rules. */
  @Get('sources/:sourceId/manual-environments')
  async listEnvironments(@Param('sourceId') sourceId: string, @Query() query: PaginationQueryDto) {
    return this.envUrls.findEnvironments(sourceId, toWindow(query, await this.settings.pageSize()));
  }

  @Post('sources/:sourceId/manual-environments')
  createEnvironment(
    @Param('sourceId') sourceId: string,
    @Body() dto: CreateManualEnvironmentDto,
  ) {
    return this.envUrls.createEnvironment(sourceId, dto);
  }

  @Patch('manual-environments/:id')
  updateEnvironment(@Param('id') id: string, @Body() dto: UpdateManualEnvironmentDto) {
    return this.envUrls.updateEnvironment(id, dto);
  }

  @Delete('manual-environments/:id')
  @HttpCode(204)
  removeEnvironment(@Param('id') id: string) {
    return this.envUrls.removeEnvironment(id);
  }
}
