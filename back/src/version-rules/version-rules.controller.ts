import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { VersionRulesService } from './version-rules.service';
import { VersionReadingsService } from './version-readings.service';
import { VersionReadingStore } from './version-reading.store';
import { toWindow, PaginationQueryDto } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { Viewer } from '../auth/access.decorator';
import { CreateVersionRuleDto } from './dto/create-version-rule.dto';
import { UpdateVersionRuleDto } from './dto/update-version-rule.dto';
import { PreviewVersionRuleDto } from './dto/preview-version-rule.dto';

/**
 * Everything here is admin-only by default — the level a route that says
 * nothing gets — and deliberately so for `preview`, which reads an address
 * given to it and hands the answer back. That is a capability, not a report.
 */
@Controller()
export class VersionRulesController {
  constructor(
    private readonly rules: VersionRulesService,
    private readonly readings: VersionReadingsService,
    private readonly store: VersionReadingStore,
    private readonly settings: SettingsService,
  ) {}

  /** The whole catalogue: rules are global, sources opt into them. */
  @Get('version-rules')
  async list(@Query() query: PaginationQueryDto) {
    return this.rules.findAll(toWindow(query, await this.settings.pageSize()));
  }

  @Post('version-rules')
  create(@Body() dto: CreateVersionRuleDto) {
    return this.rules.create(dto);
  }

  @Patch('version-rules/:id')
  update(@Param('id') id: string, @Body() dto: UpdateVersionRuleDto) {
    return this.rules.update(id, dto);
  }

  @Delete('version-rules/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.rules.remove(id);
  }

  /** Stateless: runs a candidate rule over a pasted body, or over one it reads. */
  @Post('version-rules/preview')
  @HttpCode(200)
  preview(@Body() dto: PreviewVersionRuleDto) {
    return this.rules.preview(dto);
  }

  /**
   * What this source's environments are running, as last read. A report, so it
   * follows the dashboard's own level rather than the catalogue's.
   */
  @Viewer()
  @Get('sources/:id/versions')
  versions(@Param('id') id: string) {
    return this.store.latest(id);
  }

  /**
   * Reads them again now, without waiting for the collection.
   *
   * What somebody watching a deployment go out actually wants, and the only way
   * to see a freshly written rule do something.
   *
   * Always forced, and no query parameter to say otherwise: this route exists
   * for people, and a person asking for a reading is asking about now. The
   * scheduled step keeps the interval — see `ProbeOptions.force`.
   */
  @Post('sources/:id/versions/probe')
  @HttpCode(200)
  probe(@Param('id') id: string) {
    return this.readings.probeSource(id, { force: true });
  }
}
