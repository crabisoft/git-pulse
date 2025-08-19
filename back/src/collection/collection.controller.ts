import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CollectorService } from './collector.service';

@Controller()
export class CollectionController {
  constructor(private readonly collector: CollectorService) {}

  /** Trigger an immediate collection for a source. */
  @Post('sources/:id/collect')
  @HttpCode(200)
  collect(@Param('id') id: string) {
    return this.collector.collectSource(id);
  }

  /** Metric time-series for a source (for trend charts). */
  @Get('sources/:id/metrics')
  metrics(
    @Param('id') id: string,
    @Query('metric') metric?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.collector.history(id, { metric, from, to });
  }
}
