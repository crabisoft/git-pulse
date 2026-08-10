import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { CollectorService } from './collector.service';
import type { SourcesService } from '../sources/sources.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DashboardService } from '../dashboard/dashboard.service';
import type { DoraService } from '../dora/dora.service';
import type { SyncService } from '../ingest/sync.service';
import type { ChangelogsService } from '../changelogs/changelogs.service';
import type { VersionReadingsService } from '../version-rules/version-readings.service';

/**
 * Several metrics in one read.
 *
 * The metric list draws a line beside every card, and they all come from the
 * same table over the same period. Reading them together is what keeps that
 * page to one query — and what makes the fold happen here rather than in a
 * browser, which is where it used to happen and where it was wrong.
 */

const SOURCE_ID = 'src-1';

interface Row {
  metric: string;
  value: number;
  dimensions: Record<string, string>;
  capturedAt: Date;
}

const row = (
  metric: string,
  at: string,
  value: number,
  dimensions: Record<string, string> = {},
): Row => ({ metric, value, dimensions, capturedAt: new Date(at) });

function service(rows: Row[]) {
  const findMany = vi.fn().mockImplementation(({ where }: { where: { metric: { in: string[] } } }) =>
    Promise.resolve(rows.filter((r) => where.metric.in.includes(r.metric))),
  );
  const prisma = { metricSnapshot: { findMany } } as unknown as PrismaService;
  const collector = new CollectorService(
    prisma,
    {} as DashboardService,
    {} as DoraService,
    {} as SyncService,
    {} as ChangelogsService,
    {} as VersionReadingsService,
    {} as SourcesService,
    {} as Queue,
  );
  return { collector, findMany };
}

describe('several metrics at once', () => {
  const rows = [
    row('lead_time', '2026-07-28T22:00:00Z', 3600),
    row('lead_time', '2026-07-29T22:00:00Z', 7200),
    row('deployment_frequency', '2026-07-28T22:00:00Z', 4),
  ];

  it('reads them in a single query', async () => {
    const { collector, findMany } = service(rows);

    await collector.series(SOURCE_ID, {
      metrics: ['lead_time', 'deployment_frequency'],
      dimensions: {},
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.metric).toEqual({
      in: ['lead_time', 'deployment_frequency'],
    });
  });

  it('folds each one in its own unit', async () => {
    const { collector } = service([
      ...rows,
      // Two combinations on the same day: a count adds up where a duration is
      // averaged, so the two lines cannot come out of one fold.
      row('deployment_frequency', '2026-07-28T23:00:00Z', 6, { type: 'Staging' }),
      row('lead_time', '2026-07-28T23:00:00Z', 1800, { type: 'Staging' }),
    ]);

    const [lead, frequency] = await collector.series(SOURCE_ID, {
      metrics: ['lead_time', 'deployment_frequency'],
      dimensions: {},
    });

    expect(lead.points.map((p) => p.value)).toEqual([2700, 7200]); // (3600 + 1800) / 2
    expect(frequency.points.map((p) => p.value)).toEqual([10]); // 4 + 6
  });

  it('answers for a metric with no history rather than leaving it out', async () => {
    // The caller lines the series up against its cards: an entry missing from
    // the middle of the list would silently shift every line by one.
    const { collector } = service(rows);

    const series = await collector.series(SOURCE_ID, {
      metrics: ['lead_time', 'mttr', 'deployment_frequency'],
      dimensions: {},
    });

    expect(series.map((s) => s.metric)).toEqual(['lead_time', 'mttr', 'deployment_frequency']);
    expect(series[1]).toMatchObject({ points: [], snapshotCount: 0 });
  });

  it('keeps only the combinations the filter selects, per metric', async () => {
    const { collector } = service([
      ...rows,
      row('lead_time', '2026-07-28T23:00:00Z', 60, { type: 'Staging' }),
    ]);

    const [lead] = await collector.series(SOURCE_ID, {
      metrics: ['lead_time'],
      dimensions: { type: 'Staging' },
    });

    expect(lead.points.map((p) => p.value)).toEqual([60]);
  });
});
