import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { RetentionService } from './retention.service';

const NOW = new Date('2026-07-31T12:00:00Z');
const WINDOW_DAYS = 30;
const MARGIN_DAYS = 7;

type SourceRow = { id: string; historyDays: number | null };

/**
 * The sweep, with the deletions recorded rather than run.
 *
 * `$transaction` here returns one count per queued operation, in order — which
 * is also what the service reads its totals back from, so a reordering of the
 * queue shows up as a wrong total rather than as nothing at all.
 */
function service(sources: SourceRow[], retentionMarginDays = MARGIN_DAYS) {
  const queued: Array<{ table: string; where: Record<string, unknown> }> = [];
  const deleter = (table: string) => ({
    deleteMany: ({ where }: { where: Record<string, unknown> }) => {
      queued.push({ table, where });
      return { table, count: 1 };
    },
  });
  const prisma = {
    source: { findMany: vi.fn().mockResolvedValue(sources) },
    storedPipeline: deleter('pipeline'),
    storedDeployment: deleter('deployment'),
    storedPullRequest: deleter('pullRequest'),
    webhookDelivery: deleter('delivery'),
    $transaction: (ops: unknown[]) => Promise.resolve(ops),
  } as unknown as PrismaService;
  const settings = {
    get: vi.fn().mockResolvedValue({ doraWindowDays: WINDOW_DAYS, retentionMarginDays }),
  } as unknown as SettingsService;
  return { retention: new RetentionService(prisma, settings), queued };
}

/** The cutoff a table was swept at for a source, as a day count back from now. */
function cutoffDays(
  queued: Array<{ table: string; where: Record<string, unknown> }>,
  table: string,
  sourceId: string,
): number {
  const op = queued.find((q) => q.table === table && q.where.sourceId === sourceId);
  if (!op) throw new Error(`${table} was never swept for ${sourceId}`);
  const bound = (op.where.createdAt ?? op.where.updatedAt) as { lt: Date };
  return Math.round((NOW.getTime() - bound.lt.getTime()) / 86_400_000);
}

describe('RetentionService', () => {
  it('sweeps each source at its own depth, plus the margin', async () => {
    const { retention, queued } = service([
      { id: 'deep', historyDays: 365 },
      { id: 'shallow', historyDays: 7 },
    ]);

    await retention.prune(NOW);

    // The whole point of the field: a source asked to keep a year must not be
    // swept at the week its neighbour keeps — nor at the reporting window.
    expect(cutoffDays(queued, 'pipeline', 'deep')).toBe(365 + MARGIN_DAYS);
    expect(cutoffDays(queued, 'pipeline', 'shallow')).toBe(7 + MARGIN_DAYS);
  });

  it('follows the reporting window for a source that states no depth', async () => {
    const { retention, queued } = service([{ id: 'plain', historyDays: null }]);

    await retention.prune(NOW);

    expect(cutoffDays(queued, 'deployment', 'plain')).toBe(WINDOW_DAYS + MARGIN_DAYS);
  });

  it('takes the margin from the settings rather than from a constant', async () => {
    const { retention, queued } = service([{ id: 'src', historyDays: 30 }], 90);

    await retention.prune(NOW);

    expect(cutoffDays(queued, 'pipeline', 'src')).toBe(30 + 90);
  });

  it('sweeps exactly at the depth when the margin is zero', async () => {
    // Allowed on purpose: an install short on disk can say so, and the margin
    // was never load-bearing — it buys a change of mind, nothing else.
    const { retention, queued } = service([{ id: 'src', historyDays: 30 }], 0);

    await retention.prune(NOW);

    expect(cutoffDays(queued, 'pipeline', 'src')).toBe(30);
  });

  it('spares the pull requests still open, however deep the sweep', async () => {
    const { retention, queued } = service([{ id: 'src', historyDays: 30 }]);

    await retention.prune(NOW);

    // One opened two years ago and never merged is not stale data: it is the
    // very thing the stale-PR tile exists to show.
    const prs = queued.find((q) => q.table === 'pullRequest');
    expect(prs?.where.state).toEqual({ notIn: ['open', 'draft'] });
  });

  it('counts what every source gave up, not just the last one', async () => {
    const { retention } = service([
      { id: 'a', historyDays: 30 },
      { id: 'b', historyDays: 90 },
    ]);

    const outcome = await retention.prune(NOW);

    // One row per deletion in the stub, so two sources make two of each.
    expect(outcome).toEqual({ pipelines: 2, deployments: 2, pullRequests: 2, deliveries: 1 });
  });

  it('sweeps the deliveries per install, having no depth of their own', async () => {
    const { retention, queued } = service([{ id: 'src', historyDays: 365 }]);

    await retention.prune(NOW);

    const delivery = queued.find((q) => q.table === 'delivery');
    expect(delivery?.where.sourceId).toBeUndefined();
    const bound = delivery?.where.receivedAt as { lt: Date };
    expect(Math.round((NOW.getTime() - bound.lt.getTime()) / 86_400_000)).toBe(7);
  });
});
