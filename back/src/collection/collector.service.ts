import { Injectable, Logger } from '@nestjs/common';
import type {
  MetricBucket,
  MetricPoint,
  MetricSeries,
  MetricSnapshotPublic,
  Page,
} from '@repo/shared';
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

  /**
   * A metric's history for one dimension combination, bucketed for a chart.
   *
   * The collection runs every few minutes, so a year of raw snapshots is tens
   * of thousands of rows — more than any page window carries and more than a
   * plot can say anything with. Each bucket keeps its **last** snapshot rather
   * than an average: a DORA value is already an aggregate over a rolling
   * window, so the latest reading is the state at the end of the period, where
   * averaging aggregates would blur two different things together.
   */
  async series(
    sourceId: string,
    q: {
      metric: string;
      dimensions: Record<string, string>;
      from?: string;
      to?: string;
      bucket?: MetricBucket;
    },
  ): Promise<MetricSeries> {
    const bucket = q.bucket ?? 'day';
    const rows = await this.prisma.metricSnapshot.findMany({
      where: {
        sourceId,
        metric: q.metric,
        // Exact match on the whole object: a slice is a combination, not a
        // subset. jsonb equality ignores key order, so the stored record and
        // the requested one need not agree on it.
        dimensions: { equals: q.dimensions },
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
      select: { value: true, capturedAt: true },
    });

    const byBucket = new Map<string, MetricPoint>();
    for (const row of rows) {
      const at = startOf(row.capturedAt, bucket);
      // Ordered ascending, so the last write per bucket is the latest reading.
      byBucket.set(at, { at, value: row.value });
    }

    return {
      metric: q.metric,
      dimensions: q.dimensions,
      bucket,
      points: [...byBucket.values()],
      snapshotCount: rows.length,
    };
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

/** Start of the bucket a moment falls in, in UTC. */
function startOf(at: Date, bucket: MetricBucket): string {
  const d = new Date(at);
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  if (bucket === 'hour') return d.toISOString();
  d.setUTCHours(0);
  if (bucket === 'day') return d.toISOString();
  // Weeks start on Monday, as the ISO calendar has them.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString();
}
