import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { CollectorService, refreshJobId } from './collector.service';
import type { SourcesService } from '../sources/sources.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DashboardService } from '../dashboard/dashboard.service';
import type { DoraService } from '../dora/dora.service';
import type { SyncService } from '../ingest/sync.service';
import type { ChangelogsService } from '../changelogs/changelogs.service';

const SOURCE_ID = 'src-1';

/** A job as `getJob` hands one back, in the state the test needs it. */
function jobIn(state: string) {
  return { getState: vi.fn().mockResolvedValue(state), remove: vi.fn().mockResolvedValue(undefined) };
}

function service(existing: ReturnType<typeof jobIn> | null = null) {
  const add = vi.fn().mockResolvedValue(undefined);
  const queue = { add, getJob: vi.fn().mockResolvedValue(existing) } as unknown as Queue;
  const setHistoryDays = vi.fn().mockResolvedValue(undefined);
  const sources = {
    readSpec: vi.fn().mockResolvedValue({ mode: 'stored', historyDays: 30 }),
    setHistoryDays,
  } as unknown as SourcesService;
  const collector = new CollectorService(
    {} as PrismaService,
    {} as DashboardService,
    {} as DoraService,
    {} as SyncService,
    {} as ChangelogsService,
    sources,
    queue,
  );
  return { collector, add, setHistoryDays };
}

describe('queueRefresh', () => {
  it('enqueues one forced collection under an id derived from the source', async () => {
    const { collector, add } = service();

    const handle = await collector.queueRefresh(SOURCE_ID);

    expect(handle).toEqual({ queue: 'collection', id: refreshJobId(SOURCE_ID) });
    const [name, data, options] = add.mock.calls[0];
    expect(name).toBe('collect-source');
    expect(data).toEqual({ sourceId: SOURCE_ID, force: true });
    expect(options.jobId).toBe(refreshJobId(SOURCE_ID));
    // Three attempts against an unreachable platform would be three whole API
    // budgets spent re-reading the same year.
    expect(options.attempts).toBe(1);
  });

  it('writes the depth on the source before the run', async () => {
    const { collector, setHistoryDays, add } = service();

    await collector.queueRefresh(SOURCE_ID, 365);

    // Applied to the run alone it would be swept away by the next purge, which
    // sweeps each source at the depth the source states.
    expect(setHistoryDays).toHaveBeenCalledWith(SOURCE_ID, 365);
    expect(add).toHaveBeenCalledOnce();
  });

  it('leaves the depth alone when none is asked for', async () => {
    const { collector, setHistoryDays } = service();

    await collector.queueRefresh(SOURCE_ID);

    expect(setHistoryDays).not.toHaveBeenCalled();
  });

  it('refuses a second re-read while the first is still running', async () => {
    const running = jobIn('active');
    const { collector, add } = service(running);

    await expect(collector.queueRefresh(SOURCE_ID)).rejects.toMatchObject({
      // Refused rather than silently dropped: two deep runs would spend the
      // budget twice and race each other on the cursors.
      response: { code: 'errors.collect.refreshInFlight' },
    });
    expect(add).not.toHaveBeenCalled();
    expect(running.remove).not.toHaveBeenCalled();
  });

  it('refuses it while it is merely waiting, too', async () => {
    const { collector, add } = service(jobIn('waiting'));

    await expect(collector.queueRefresh(SOURCE_ID)).rejects.toMatchObject({
      response: { code: 'errors.collect.refreshInFlight' },
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('treats a state it does not know as still running', async () => {
    // BullMQ has grown states before. An unrecognised one has to read as "still
    // going": mistaking a running job for a finished one is what would let a
    // second deep read start alongside the first.
    const { collector, add } = service(jobIn('waiting-children'));

    await expect(collector.queueRefresh(SOURCE_ID)).rejects.toMatchObject({
      response: { code: 'errors.collect.refreshInFlight' },
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('supersedes the result of a run that already finished', async () => {
    const done = jobIn('completed');
    const { collector, add } = service(done);

    await collector.queueRefresh(SOURCE_ID);

    // A settled job is a result being kept for whoever started it, not a claim
    // on the source — and BullMQ would refuse to reuse its id otherwise.
    expect(done.remove).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
  });

  it('supersedes a failed one just the same', async () => {
    const failed = jobIn('failed');
    const { collector, add } = service(failed);

    await collector.queueRefresh(SOURCE_ID);

    expect(failed.remove).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
  });
});
