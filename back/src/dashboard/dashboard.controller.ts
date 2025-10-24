import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DashboardService } from './dashboard.service';
import { DashboardLiveQueryDto } from './dto/dashboard-live-query.dto';
import { abortOnDisconnect } from '../common/request-abort';
import { Viewer } from '../auth/access.decorator';

/** The public half of the application, when the setting says it is public. */
@Viewer()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Aggregated live view for a source. */
  @Get(':sourceId/live')
  live(
    @Param('sourceId') sourceId: string,
    @Query() query: DashboardLiveQueryDto,
    // `passthrough` keeps Nest in charge of the response: the handler still
    // returns its payload, `res` is only watched for the disconnect.
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.dashboard.live(sourceId, query, abortOnDisconnect(res));
  }
}
