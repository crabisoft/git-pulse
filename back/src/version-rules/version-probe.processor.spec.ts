import { describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import { VersionProbeProcessor } from './version-probe.processor';
import { PROBE_JOB } from './probe-job';

function build(outcomes: Array<{ read: boolean; changed: boolean }>) {
  const probeDeployment = vi.fn();
  for (const outcome of outcomes) probeDeployment.mockResolvedValueOnce(outcome);
  const add = vi.fn().mockResolvedValue({ id: 'job' });
  const queue = { getJob: vi.fn().mockResolvedValue(undefined), add } as unknown as Queue;
  return {
    processor: new VersionProbeProcessor({ probeDeployment } as never, queue),
    probeDeployment,
    add,
  };
}

function job(data: Record<string, unknown> = {}): Job {
  return {
    name: PROBE_JOB,
    data: { sourceId: 'src-1', repo: 'acme/api', environment: 'prod', ...data },
  } as Job;
}

describe('reading an environment after a deployment', () => {
  it('reads the pair the event named', async () => {
    const { processor, probeDeployment } = build([{ read: true, changed: true }]);

    await processor.process(job());

    expect(probeDeployment).toHaveBeenCalledWith('src-1', 'acme/api', 'prod');
  });

  it('stops when the version has moved', async () => {
    const { processor, add } = build([{ read: true, changed: true }]);

    const result = await processor.process(job());

    expect(add).not.toHaveBeenCalled();
    expect(result).toMatchObject({ retried: false });
  });

  it('reads once more when the environment still answers the old version', async () => {
    // The usual reason: it had not finished restarting when the settling delay
    // ran out.
    const { processor, add } = build([{ read: true, changed: false }]);

    await processor.process(job());

    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][1]).toMatchObject({ attempt: 2 });
  });

  it('never reads a third time', async () => {
    // A redeployment of the same version is legitimate and indistinguishable
    // from an application that has not come back, so this stops rather than
    // waiting for a change that may never come. What was read is already filed.
    const { processor, add } = build([{ read: true, changed: false }]);

    const result = await processor.process(job({ attempt: 2 }));

    expect(add).not.toHaveBeenCalled();
    expect(result).toMatchObject({ retried: false });
  });

  it('does not retry a reading that was never taken', async () => {
    // No rule claimed the environment, or nothing successful was found on it.
    // Asking again in thirty seconds would answer exactly the same.
    const { processor, add } = build([{ read: false, changed: false }]);

    await processor.process(job());

    expect(add).not.toHaveBeenCalled();
  });

  it('ignores a job it does not know', async () => {
    const { processor, probeDeployment } = build([]);

    expect(await processor.process({ name: 'something-else', data: {} } as Job)).toBeNull();
    expect(probeDeployment).not.toHaveBeenCalled();
  });
});
