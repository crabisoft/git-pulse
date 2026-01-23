import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { JobHandle } from '@repo/shared';
import { CollectorService } from './collector.service';
import { MetricsQueryDto } from './dto/metrics-query.dto';
import { RefreshSourceDto } from './dto/refresh-source.dto';
import { MetricSeriesDto } from './dto/metric-series.dto';
import { toDimensionFilter } from '../dora/dto/dora-query.dto';
import { toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { Viewer } from '../auth/access.decorator';

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

  /**
   * Queues a collection made to re-read the whole depth rather than what
   * changed, and returns a handle to follow it by.
   *
   * A route of its own rather than a flag on the one above: this one can cost
   * an entire API budget on a deep source, and that is not something a caller
   * should be able to ask for by mistyping a query string. Queued rather than
   * run here for the same reason — it outlives the request that asked for it,
   * and a tab closing must not be what decides whether it finished.
   *
   * A depth supplied here is written to the source before the run. See
   * `RefreshSourceDto`: applied to this run alone it would be swept away by the
   * next purge, which sweeps each source at the depth the source states.
   */
  @Post('sources/:id/refresh')
  @HttpCode(202)
  refresh(@Param('id') id: string, @Body() dto: RefreshSourceDto): Promise<JobHandle> {
    return this.collector.queueRefresh(id, dto.historyDays);
  }

  /** One metric over a period, folded over the filter and bucketed by day. */
  @Viewer()
  @Get('sources/:id/metrics/series')
  series(@Param('id') id: string, @Query() query: MetricSeriesDto) {
    return this.collector.series(id, {
      metric: query.metric,
      dimensions: toDimensionFilter(query.dimension),
      from: query.from,
      to: query.to,
    });
  }

  /** Raw snapshots, paginated. */
  @Viewer()
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
