import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IncidentsService } from './incidents.service';
import { IncidentsQueryDto } from './dto/incidents-query.dto';
import { SettingsService } from '../settings/settings.service';
import { resolvePeriod } from '../common/period';
import { abortOnDisconnect } from '../common/request-abort';
import { Viewer } from '../auth/access.decorator';

/** The public half of the application, when the setting says it is public. */
@Viewer()
@Controller()
export class IncidentsController {
  constructor(
    private readonly incidents: IncidentsService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Incidents over a period. The period is resolved the same way every report
   * resolves one, so "the last 30 days" means the same thing on the timeline
   * as it does on the metric beside it.
   */
  @Get('sources/:id/incidents')
  async list(
    @Param('id') id: string,
    @Query() query: IncidentsQueryDto,
    // `passthrough` keeps Nest in charge of the response: the handler still
    // returns its payload, `res` is only watched for the disconnect.
    @Res({ passthrough: true }) res: Response,
  ) {
    const signal = abortOnDisconnect(res);
    const period = resolvePeriod(
      { from: query.from, to: query.to, windowDays: query.windowDays },
      (await this.settings.get()).doraWindowDays,
    );
    return this.incidents.list(id, period, query.repos ?? [], signal);
  }
}
