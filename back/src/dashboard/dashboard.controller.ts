import { Controller, Get, Param } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Aggregated live view for a source. */
  @Get(':sourceId/live')
  live(@Param('sourceId') sourceId: string) {
    return this.dashboard.live(sourceId);
  }
}
