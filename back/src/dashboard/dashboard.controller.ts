import { Controller, Get, Param, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardLiveQueryDto } from './dto/dashboard-live-query.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Aggregated live view for a source. */
  @Get(':sourceId/live')
  live(@Param('sourceId') sourceId: string, @Query() query: DashboardLiveQueryDto) {
    return this.dashboard.live(sourceId, query);
  }
}
