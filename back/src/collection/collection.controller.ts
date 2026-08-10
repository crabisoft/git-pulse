import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { JobHandle } from '@repo/shared';
import { CollectorService } from './collector.service';
import { MetricsQueryDto } from './dto/metrics-query.dto';
import { RefreshSourceDto } from './dto/refresh-source.dto';
import { RebuildMetricsDto } from './dto/rebuild-metrics.dto';
import { MetricSeriesDto } from './dto/metric-series.dto';
import { toDimensionFilter } from '../dora/dto/dora-query.dto';
import { toWindow } from '../common/pagination';
import { resolvePeriod } from '../common/period';
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

  /**
   * Queues a replay of the DORA metric history over the requested depth.
   *
   * Admin like the re-read above, and destructive in the same measure: it
   * replaces the readings of the range it covers. What it does not touch —
   * anything older, and the summary series — is reported back by the job.
   */
  @Post('sources/:id/dora/rebuild')
  @HttpCode(202)
  rebuild(@Param('id') id: string, @Body() dto: RebuildMetricsDto): Promise<JobHandle> {
    return this.collector.queueRebuild(id, dto.days);
  }

  /**
   * The requested metrics over a period, each folded over the filter and
   * bucketed by day. One series per metric asked for, in the order asked.
   *
   * The period is resolved here, through the same function the DORA report
   * uses and against the same default: the chart and the value beside it are
   * two readings of one window, and a window stated as "the last 90 days"
   * carries no bounds for a query to filter on until somebody resolves it.
   */
  @Viewer()
  @Get('sources/:id/metrics/series')
  async series(@Param('id') id: string, @Query() query: MetricSeriesDto) {
    const period = resolvePeriod(query, (await this.settings.get()).doraWindowDays);
    return this.collector.series(id, {
      metrics: query.metric,
      dimensions: toDimensionFilter(query.dimension),
      from: period.from,
      to: period.to,
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
