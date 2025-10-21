import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CollectorService } from './collector.service';
import { MetricsQueryDto } from './dto/metrics-query.dto';
import { MetricSeriesDto } from './dto/metric-series.dto';
import { toDimensionFilter } from '../dora/dto/dora-query.dto';
import { toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';

@Controller()
export class CollectionController {
  constructor(
    private readonly collector: CollectorService,
    private readonly settings: SettingsService,
  ) {}

  /** Trigger an immediate collection for a source. */
  @Post('sources/:id/collect')
  @HttpCode(200)
  collect(@Param('id') id: string) {
    return this.collector.collectSource(id);
  }

  /** One metric, one dimension combination, bucketed for a chart. */
  @Get('sources/:id/metrics/series')
  series(@Param('id') id: string, @Query() query: MetricSeriesDto) {
    return this.collector.series(id, {
      metric: query.metric,
      dimensions: toDimensionFilter(query.dimension),
      from: query.from,
      to: query.to,
      bucket: query.bucket,
    });
  }

  /** Raw snapshots, paginated. */
  @Get('sources/:id/metrics')
  async metrics(@Param('id') id: string, @Query() query: MetricsQueryDto) {
    const { metric, from, to } = query;
    return this.collector.history(
      id,
      { metric, from, to },
      toWindow(query, await this.settings.pageSize()),
    );
  }
}
