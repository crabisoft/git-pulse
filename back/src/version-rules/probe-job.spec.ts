import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { PROBE_JOB, enqueueProbe, probeJobId } from './probe-job';
import { PROBE_SETTLE_SECONDS } from './version-readings.service';

/** A queue holding at most one job, which is all the debounce needs. */
function queue(held: { state: string } | null = null) {
  const existing = held && {
    getState: vi.fn().mockResolvedValue(held.state),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const q = {
    getJob: vi.fn().mockResolvedValue(existing ?? undefined),
    add: vi.fn().mockResolvedValue({ id: 'job' }),
  };
  return { queue: q as unknown as Queue, q, existing };
}

const TARGET = { sourceId: 'src-1', repo: 'acme/api', environment: 'prod' };

describe('queueing a reading for an environment', () => {
  it('waits for the application to come back before reading', async () => {
    const { queue: q, q: spy } = queue();

    await enqueueProbe(q, TARGET);

    const [name, , options] = spy.add.mock.calls[0];
    expect(name).toBe(PROBE_JOB);
    // An event fires when the platform calls the deployment done, which is
    // before the application has finished restarting.
    expect(options.delay).toBe(PROBE_SETTLE_SECONDS * 1000);
  });

  it('keys the job on the environment, not on the deployment', async () => {
    const { queue: q, q: spy } = queue();

    await enqueueProbe(q, TARGET);

    expect(spy.add.mock.calls[0][2].jobId).toBe(probeJobId('src-1', 'acme/api', 'prod'));
  });

  it('turns several events for one deployment into one reading', async () => {
    // A deployment emits a status event per transition. Three of them must not
    // become three connections into somebody's application.
    const { queue: q, q: spy } = queue({ state: 'delayed' });

    const queued = await enqueueProbe(q, TARGET);

    expect(queued).toBe(false);
    expect(spy.add).not.toHaveBeenCalled();
  });

  it('leaves a reading that is already running alone', async () => {
    const { queue: q, q: spy } = queue({ state: 'active' });

    expect(await enqueueProbe(q, TARGET)).toBe(false);
    expect(spy.add).not.toHaveBeenCalled();
  });

  it('replaces a settled job, which is a result and not a claim', async () => {
    // The previous reading is kept in the history, and its id with it. A new
    // deployment must not be refused because the last one was read.
    const { queue: q, q: spy, existing } = queue({ state: 'completed' });

    expect(await enqueueProbe(q, TARGET)).toBe(true);
    expect(existing?.remove).toHaveBeenCalled();
    expect(spy.add).toHaveBeenCalled();
  });

  it('never lets BullMQ retry a reading', async () => {
    // A reading that failed is filed as a failure and shown as one. Three
    // attempts would file it three times and call the application three times.
    const { queue: q, q: spy } = queue();

    await enqueueProbe(q, TARGET);

    expect(spy.add.mock.calls[0][2].attempts).toBe(1);
  });
});
