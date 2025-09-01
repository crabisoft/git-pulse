import { Injectable, Logger } from '@nestjs/common';
import type { MetricSnapshotPublic, Page } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { DoraService } from '../dora/dora.service';
import { toPage, type PageWindow } from '../common/pagination';

interface HistoryQuery {
  metric?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class CollectorService {
  private readonly logger = new Logger(CollectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
    private readonly dora: DoraService,
  ) {}

  /** Fetch live data for a source and persist metric snapshots. */
  async collectSource(sourceId: string): Promise<MetricSnapshotPublic[]> {
    const live = await this.dashboard.live(sourceId);
    const capturedAt = new Date();
    const points: Array<{ metric: string; value: number }> = [
      { metric: 'open_prs', value: live.summary.openPrs },
      { metric: 'stale_prs', value: live.summary.stalePrs },
      { metric: 'failed_pipelines', value: live.summary.failedPipelines },
      { metric: 'running_pipelines', value: live.summary.runningPipelines },
    ];
    const created = await this.prisma.$transaction(
      points.map((p) =>
        this.prisma.metricSnapshot.create({
          data: { sourceId, metric: p.metric, value: p.value, dimensions: {}, capturedAt },
        }),
      ),
    );

    // DORA collection is heavier (many API calls) and best-effort: a failure
    // here must not drop the summary snapshots above.
    await this.dora.snapshot(sourceId).catch((e) => {
      this.logger.warn(`Snapshot DORA échoué pour ${sourceId} : ${asMessage(e)}`);
    });

    return created.map(toPublic);
  }

  /** Time-series read for trends (optionally filtered by metric / range). */
  async history(
    sourceId: string,
    q: HistoryQuery,
    window: PageWindow,
  ): Promise<Page<MetricSnapshotPublic>> {
    const where = {
      sourceId,
      ...(q.metric ? { metric: q.metric } : {}),
      ...(q.from || q.to
        ? {
            capturedAt: {
              gte: q.from ? new Date(q.from) : undefined,
              lte: q.to ? new Date(q.to) : undefined,
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.metricSnapshot.findMany({
        where,
        orderBy: { capturedAt: 'asc' },
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.metricSnapshot.count({ where }),
    ]);
    return toPage(rows.map(toPublic), total, window);
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toPublic(r: {
  id: string;
  sourceId: string;
  metric: string;
  value: number;
  dimensions: unknown;
  capturedAt: Date;
}): MetricSnapshotPublic {
  return {
    id: r.id,
    sourceId: r.sourceId,
    metric: r.metric,
    value: r.value,
    dimensions: (r.dimensions as Record<string, string>) ?? {},
    capturedAt: r.capturedAt.toISOString(),
  };
}
