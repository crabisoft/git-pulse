import { Controller, Get, Param, Query } from '@nestjs/common';
import { ChangelogsService } from './changelogs.service';
import { ListChangelogsDto } from './dto/list-changelogs.dto';
import { toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { Viewer } from '../auth/access.decorator';

/**
 * The archive of what deployments carried.
 *
 * No abort handling, unlike every other reporting route: this one reads rows
 * that are already written and makes no call to a platform, which is the whole
 * point of it existing. A history months deep answers as fast as yesterday's.
 */
@Viewer()
@Controller()
export class ChangelogsController {
  constructor(
    private readonly changelogs: ChangelogsService,
    private readonly settings: SettingsService,
  ) {}

  @Get('sources/:id/changelogs')
  async list(@Param('id') id: string, @Query() query: ListChangelogsDto) {
    return this.changelogs.list(
      id,
      { repos: query.repo, environments: query.environment, search: query.search },
      {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      toWindow(query, await this.settings.pageSize()),
    );
  }

  /** One filed changelog, keyed on the deployment it describes. */
  @Get('sources/:id/changelogs/:deploymentId')
  get(@Param('id') id: string, @Param('deploymentId') deploymentId: string) {
    return this.changelogs.get(id, deploymentId);
  }
}
