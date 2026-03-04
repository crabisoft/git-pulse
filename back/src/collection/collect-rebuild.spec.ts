import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { CollectorService } from './collector.service';
import type { SourcesService } from '../sources/sources.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DashboardService } from '../dashboard/dashboard.service';
import type { DoraService } from '../dora/dora.service';
import type { SyncService } from '../ingest/sync.service';
import type { ChangelogsService } from '../changelogs/changelogs.service';

/**
 * When a collection replays the metric history, and when it must not.
 *
 * The whole point of tying it to `force`: a scheduled run adds a day to a
 * history the run before it already agreed with, so replaying on every tick
 * would rewrite months of readings every few minutes to land on the same
 * values.
 */

const SOURCE_ID = 'src-1';

function service(
  rebuild = vi.fn().mockResolvedValue({ written: 0 }),
  historyDays: number | null = 90,
) {
  const prisma = {
    metricSnapshot: { create: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  } as unknown as PrismaService;

  const dora = { rebuild, snapshot: vi.fn().mockResolvedValue(0) } as unknown as DoraService;
  const collector = new CollectorService(
    prisma,
    {
      live: vi.fn().mockResolvedValue({
        summary: { openPrs: 0, stalePrs: 0, failedPipelines: 0, runningPipelines: 0 },
      }),
    } as unknown as DashboardService,
    dora,
    { syncIfStored: vi.fn().mockResolvedValue(null) } as unknown as SyncService,
    { archive: vi.fn().mockResolvedValue({ archived: 0 }) } as unknown as ChangelogsService,
    {
      readSpec: vi.fn().mockResolvedValue({ mode: 'stored', historyDays }),
    } as unknown as SourcesService,
    {} as Queue,
  );
  return { collector, rebuild };
}

describe('a collection and the metric history', () => {
  it('replays it on a deep re-read, over the depth of the source', async () => {
    const { collector, rebuild } = service();

    await collector.collect(SOURCE_ID, { force: true });

    expect(rebuild).toHaveBeenCalledWith(SOURCE_ID, 90);
  });

  it('leaves it alone on a scheduled run', async () => {
    const { collector, rebuild } = service();

    await collector.collect(SOURCE_ID);

    expect(rebuild).not.toHaveBeenCalled();
  });

  it('falls back to the window when the source states no depth', async () => {
    const { collector, rebuild } = service(undefined, null);

    await collector.collect(SOURCE_ID, { force: true });

    // Undefined rather than null: the service owns that default, and passing
    // null would have it replay a single day.
    expect(rebuild).toHaveBeenCalledWith(SOURCE_ID, undefined);
  });

  it('degrades a failed replay into a warning rather than losing the run', async () => {
    // The replay is transactional, so a failure leaves the old readings in
    // place — and the capture of the day is still worth writing.
    const { collector } = service(vi.fn().mockRejectedValue(new Error('nope')));

    const outcome = await collector.collect(SOURCE_ID, { force: true });

    expect(outcome.warnings.map((w) => w.code)).toContain('errors.collect.rebuild');
  });
});
