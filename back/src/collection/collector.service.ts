import { Injectable } from '@nestjs/common';
import type { MetricSnapshotPublic } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from '../dashboard/dashboard.service';

interface HistoryQuery {
  metric?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class CollectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
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
    return created.map(toPublic);
  }

  /** Time-series read for trends (optionally filtered by metric / range). */
  async history(sourceId: string, q: HistoryQuery): Promise<MetricSnapshotPublic[]> {
    const rows = await this.prisma.metricSnapshot.findMany({
      where: {
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
      },
      orderBy: { capturedAt: 'asc' },
      take: 2000,
    });
    return rows.map(toPublic);
  }
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
