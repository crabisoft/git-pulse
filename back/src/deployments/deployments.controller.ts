import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DeploymentsService } from './deployments.service';
import { toDimensionFilter } from '../dora/dto/dora-query.dto';
import { DeploymentChangesDto, ListDeploymentsDto } from './dto/list-deployments.dto';
import { toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { abortOnDisconnect } from '../common/request-abort';
import { Viewer } from '../auth/access.decorator';

/** Reporting over the same data the dashboard shows, so it follows it. */
@Viewer()
@Controller()
export class DeploymentsController {
  constructor(
    private readonly deployments: DeploymentsService,
    private readonly settings: SettingsService,
  ) {}

  @Get('sources/:id/deployments')
  async list(
    @Param('id') id: string,
    @Query() query: ListDeploymentsDto,
    // Listing a live source is a round of connector calls: the same hang-up
    // handling as the dashboard and DORA applies.
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deployments.list(
      id,
      {
        from: query.from,
        to: query.to,
        windowDays: query.windowDays,
        repos: query.repos,
        environments: query.environment,
        statuses: query.status,
        dimensions: toDimensionFilter(query.dimension),
      },
      toWindow(query, await this.settings.pageSize()),
      abortOnDisconnect(res),
    );
  }

  /** What one deployment carried, against the base the caller asked for. */
  @Get('sources/:id/deployments/:deploymentId/changes')
  changes(
    @Param('id') id: string,
    @Param('deploymentId') deploymentId: string,
    @Query() query: DeploymentChangesDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deployments.changes(
      id,
      deploymentId,
      query.repo,
      query.base ?? 'previous',
      query.ref,
      { from: query.from, to: query.to, windowDays: query.windowDays },
      abortOnDisconnect(res),
    );
  }
}
