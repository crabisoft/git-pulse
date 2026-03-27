import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoraService } from './dora.service';

/**
 * Replaying the metric history.
 *
 * The risk here is not the arithmetic — the metric functions have their own
 * suite — it is what gets deleted and what gets stamped. Both are asserted
 * against the arguments handed to Prisma, which is where a mistake would cost
 * data rather than a wrong number.
 */

const SOURCE_ID = 'src-1';
const NOW = '2026-08-01T09:00:00.000Z';

function deployment(at: string) {
  return {
    id: `d-${at}`,
    repo: 'api',
    environment: 'Prod',
    ref: 'v1',
    status: 'success' as const,
    createdAt: at,
    environmentUrl: null,
    url: null,
  };
}

function service(deployments: ReturnType<typeof deployment>[]) {
  const deleteMany = vi.fn().mockResolvedValue({ count: 7 });
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  const count = vi.fn().mockResolvedValue(42);
  const prisma = {
    metricSnapshot: { deleteMany, createMany, count },
    // The transaction runs what it was given, in order, like the real one.
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };

  const reader = {
    mode: 'stored',
    scope: { owner: 'acme' },
    listRepositories: vi.fn().mockResolvedValue(['api']),
    listDeployments: vi.fn().mockResolvedValue(deployments),
    listMergedPullRequests: vi.fn().mockResolvedValue([]),
  };

  const dora = new DoraService(
    prisma as never,
    {} as never,
    { for: vi.fn().mockResolvedValue(reader) } as never,
    {} as never,
    { incidentTrackerFor: vi.fn().mockResolvedValue(null) } as never,
    { classifyByPair: vi.fn().mockResolvedValue(new Map()) } as never,
    { extractMany: vi.fn().mockResolvedValue([]) } as never,
    {
      get: vi.fn().mockResolvedValue({
        doraWindowDays: 30,
        failureSource: 'pipelines',
        incidentLabels: [],
      }),
    } as never,
  );
  return { dora, deleteMany, createMany, count, reader };
}

beforeEach(() => {
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DoraService.rebuild', () => {
  it('sweeps the DORA metrics of the range, and nothing else in the table', async () => {
    // The summary series shares this table and is a reading of the present:
    // deleting it would lose what no replay can reconstruct.
    const { dora, deleteMany } = service([deployment('2026-07-30T10:00:00.000Z')]);

    await dora.rebuild(SOURCE_ID, 3);

    const [{ where }] = deleteMany.mock.calls[0];
    expect(where.sourceId).toBe(SOURCE_ID);
    expect(where.metric.in).toContain('lead_time');
    expect(where.metric.in).not.toContain('open_prs');
  });

  it('stops at the end of yesterday, leaving today to the next collection', async () => {
    const { dora, deleteMany } = service([deployment('2026-07-30T10:00:00.000Z')]);

    const outcome = await dora.rebuild(SOURCE_ID, 3);

    // Today is 1 August, so three days are 29, 30 and 31 July — and nothing
    // of today, whatever the hour the replay runs at.
    expect(outcome.from).toBe('2026-07-29T00:00:00.000Z');
    expect(outcome.to).toBe('2026-07-31T23:59:59.999Z');
    const [{ where }] = deleteMany.mock.calls[0];
    expect(where.capturedAt.lte.toISOString()).toBe('2026-07-31T23:59:59.999Z');
  });

  it('stamps every reading at the end of the day it describes', async () => {
    // The daily fold reads a snapshot's date on its UTC day; a reading filed
    // on the wrong side of midnight lands on a day it does not describe.
    const { dora, createMany } = service([deployment('2026-07-30T10:00:00.000Z')]);

    await dora.rebuild(SOURCE_ID, 2);

    const [{ data }] = createMany.mock.calls[0];
    const stamps = [...new Set(data.map((r: { capturedAt: Date }) => r.capturedAt.toISOString()))];
    expect(stamps).toEqual(['2026-07-30T23:59:59.999Z', '2026-07-31T23:59:59.999Z']);
  });

  it('writes nothing for a day whose window holds no event', async () => {
    // A flat zero would read as a measurement; a gap reads as a gap.
    const { dora, createMany } = service([]);

    const outcome = await dora.rebuild(SOURCE_ID, 5);

    expect(outcome.days).toBe(0);
    expect(outcome.written).toBe(0);
    expect(createMany.mock.calls[0][0].data).toEqual([]);
  });

  it('reads the platform once, however many days it replays', async () => {
    // The whole reason this is affordable: classifying an event does not
    // depend on the period, so ninety days cost one gathering.
    const { dora, reader } = service([deployment('2026-07-30T10:00:00.000Z')]);

    await dora.rebuild(SOURCE_ID, 60);

    expect(reader.listDeployments).toHaveBeenCalledTimes(1);
    expect(reader.listMergedPullRequests).toHaveBeenCalledTimes(1);
  });

  it('reaches a whole window back, so the first day replayed is not truncated', async () => {
    const { dora, reader } = service([deployment('2026-07-30T10:00:00.000Z')]);

    await dora.rebuild(SOURCE_ID, 2);

    // First day replayed is 31 July − 1 = 30 July, and its window opens 30
    // days earlier: the listing has to start there, not at the range.
    const [, since] = reader.listMergedPullRequests.mock.calls[0];
    expect(since).toBe('2026-06-30T00:00:00.000Z');
  });

  it('reaches as far back for the deployments as for the merges', async () => {
    // They used to be read unbounded, which reads as "everything" and means
    // the opposite: the most recent slice per repo. A replay of sixty days was
    // then built from whatever those rows happened to span.
    const { dora, reader } = service([deployment('2026-07-30T10:00:00.000Z')]);

    await dora.rebuild(SOURCE_ID, 2);

    const [, deploymentsSince] = reader.listDeployments.mock.calls[0];
    const [, mergesSince] = reader.listMergedPullRequests.mock.calls[0];
    expect(deploymentsSince).toBe(mergesSince);
  });

  it('counts what it left untouched before the range', async () => {
    // Those keep the classification they were written with, and the caller has
    // to be able to say so rather than let two eras be read as one.
    const { dora, count } = service([deployment('2026-07-30T10:00:00.000Z')]);

    const outcome = await dora.rebuild(SOURCE_ID, 3);

    expect(outcome.keptBefore).toBe(42);
    expect(count.mock.calls[0][0].where.capturedAt.lt.toISOString()).toBe(
      '2026-07-29T00:00:00.000Z',
    );
  });
});
