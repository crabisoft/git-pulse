import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { CoverageService } from './coverage.service';

const NOW = new Date('2026-08-01T12:00:00Z');
const WINDOW_DAYS = 30;
const MARGIN_DAYS = 7;

type SourceRow = { id: string; mode: string; historyDays: number | null };
/** What a `groupBy` gives back, per table, with the column already named. */
type Group = { sourceId: string; min: string; max: string; count: number };

function service(
  sources: SourceRow[],
  tables: {
    deployments?: Group[];
    pullRequests?: Group[];
    pipelines?: Group[];
    metrics?: Group[];
  } = {},
) {
  /** Rebuilds the `_min`/`_max` shape Prisma answers with, for one column. */
  const grouped = (rows: Group[] = [], column: string) => ({
    groupBy: vi.fn().mockResolvedValue(
      rows.map((row) => ({
        sourceId: row.sourceId,
        _min: { [column]: new Date(row.min) },
        _max: { [column]: new Date(row.max) },
        _count: { _all: row.count },
      })),
    ),
  });
  const prisma = {
    source: { findMany: vi.fn().mockResolvedValue(sources) },
    storedDeployment: grouped(tables.deployments, 'createdAt'),
    storedPullRequest: grouped(tables.pullRequests, 'openedAt'),
    storedPipeline: grouped(tables.pipelines, 'createdAt'),
    metricSnapshot: grouped(tables.metrics, 'capturedAt'),
  } as unknown as PrismaService;
  const settings = {
    get: vi.fn().mockResolvedValue({
      doraWindowDays: WINDOW_DAYS,
      retentionMarginDays: MARGIN_DAYS,
    }),
  } as unknown as SettingsService;
  return new CoverageService(prisma, settings);
}

describe('CoverageService', () => {
  it('counts the days from the oldest row to now', async () => {
    const coverage = service(
      [{ id: 'src', mode: 'stored', historyDays: 90 }],
      {
        deployments: [
          { sourceId: 'src', min: '2026-06-15T09:00:00Z', max: '2026-08-01T08:00:00Z', count: 312 },
        ],
      },
    );

    const [row] = await coverage.list(NOW);

    expect(row.deployments).toEqual({
      from: '2026-06-15T09:00:00.000Z',
      to: '2026-08-01T08:00:00.000Z',
      days: 47,
      count: 312,
    });
  });

  it('reports the DORA history apart from the store it was computed from', async () => {
    // The whole reason the two are stated separately: the store can go back
    // months while the readings only start the day the collection did.
    const coverage = service([{ id: 'src', mode: 'stored', historyDays: 365 }], {
      deployments: [
        { sourceId: 'src', min: '2025-09-01T00:00:00Z', max: '2026-08-01T00:00:00Z', count: 4000 },
      ],
      metrics: [
        { sourceId: 'src', min: '2026-07-20T00:00:00Z', max: '2026-08-01T00:00:00Z', count: 96 },
      ],
    });

    const [row] = await coverage.list(NOW);

    expect(row.deployments.days).toBe(334);
    expect(row.metrics.days).toBe(12);
  });

  it('states the configured depth and what the sweep keeps beyond it', async () => {
    const coverage = service([{ id: 'src', mode: 'stored', historyDays: 90 }]);

    const [row] = await coverage.list(NOW);

    expect(row.depthDays).toBe(90);
    expect(row.retainedDays).toBe(90 + MARGIN_DAYS);
  });

  it('follows the reporting window for a source that states no depth', async () => {
    const coverage = service([{ id: 'src', mode: 'stored', historyDays: null }]);

    const [row] = await coverage.list(NOW);

    expect(row.depthDays).toBe(WINDOW_DAYS);
  });

  it('gives a live source no depth, having no store to keep it in', async () => {
    const coverage = service([{ id: 'src', mode: 'live', historyDays: 90 }], {
      metrics: [
        { sourceId: 'src', min: '2026-07-25T00:00:00Z', max: '2026-08-01T00:00:00Z', count: 40 },
      ],
    });

    const [row] = await coverage.list(NOW);

    expect(row.depthDays).toBeNull();
    expect(row.retainedDays).toBeNull();
    // Its metrics are historized all the same — a live source is read at every
    // request, and every collection still writes down what it read.
    expect(row.metrics.days).toBe(7);
  });

  it('reports an empty table as empty rather than as an absent source', async () => {
    const coverage = service([{ id: 'fresh', mode: 'stored', historyDays: 30 }]);

    const [row] = await coverage.list(NOW);

    expect(row.deployments).toEqual({ from: null, to: null, days: null, count: 0 });
    expect(row.sourceId).toBe('fresh');
  });

  it('floors a table filled within the hour at one day', async () => {
    const coverage = service([{ id: 'src', mode: 'stored', historyDays: 30 }], {
      pipelines: [
        { sourceId: 'src', min: '2026-08-01T09:00:00Z', max: '2026-08-01T11:00:00Z', count: 4 },
      ],
    });

    const [row] = await coverage.list(NOW);

    // "0 day" next to four rows reads as a bug rather than as a young store.
    expect(row.pipelines.days).toBe(1);
  });

  it('answers for every source from one aggregate per table', async () => {
    const coverage = service(
      [
        { id: 'a', mode: 'stored', historyDays: 30 },
        { id: 'b', mode: 'stored', historyDays: 30 },
      ],
      {
        deployments: [
          { sourceId: 'a', min: '2026-07-01T00:00:00Z', max: '2026-08-01T00:00:00Z', count: 10 },
          { sourceId: 'b', min: '2026-07-25T00:00:00Z', max: '2026-08-01T00:00:00Z', count: 3 },
        ],
      },
    );

    const rows = await coverage.list(NOW);

    expect(rows.map((r) => r.deployments.days)).toEqual([31, 7]);
  });
});
