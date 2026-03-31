import { describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import type { Deployment } from '@repo/shared';
import { IngestProcessor } from './ingest.processor';
import { probeJobId } from '../../version-rules/probe-job';

function build(held: { state: string } | null = null) {
  const existing = held && {
    getState: vi.fn().mockResolvedValue(held.state),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const add = vi.fn().mockResolvedValue({ id: 'job' });
  const probes = {
    getJob: vi.fn().mockResolvedValue(existing ?? undefined),
    add,
  } as unknown as Queue;
  const store = {
    upsertDeployments: vi.fn().mockResolvedValue(1),
    upsertPipelines: vi.fn().mockResolvedValue(1),
    upsertPullRequests: vi.fn().mockResolvedValue(1),
  };
  return { processor: new IngestProcessor(store as never, probes), store, add };
}

function deployment(over: Partial<Deployment> = {}): Deployment {
  return {
    id: 'gh:acme/api:42',
    repo: 'acme/api',
    environment: 'prod',
    ref: 'v1.4.2',
    status: 'success',
    createdAt: '2026-08-02T10:00:00.000Z',
    environmentUrl: 'https://api.acme.test',
    url: null,
    ...over,
  };
}

function job(item: Deployment): Job {
  return {
    name: 'ingest-event',
    data: { sourceId: 'src-1', intent: { kind: 'deployment', item } },
  } as Job;
}

describe('what a deployment event sets off', () => {
  it('asks for a reading of the environment it reached', async () => {
    const { processor, add, store } = build();

    await processor.process(job(deployment()));

    expect(store.upsertDeployments).toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][2].jobId).toBe(probeJobId('src-1', 'acme/api', 'prod'));
  });

  it.each(['failed', 'running', 'pending'] as const)(
    'asks for nothing when the deployment is %s',
    async (status) => {
      // Nothing was put on the environment, so a reading would describe what
      // was already there — and freeze it against the wrong deployment.
      const { processor, add, store } = build();

      await processor.process(job(deployment({ status })));

      // The row is still written: the deployment happened, whatever it did.
      expect(store.upsertDeployments).toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    },
  );

  it('turns a deployment’s several status events into one reading', async () => {
    // The second event finds the first reading still waiting out its delay.
    const { processor, add } = build({ state: 'delayed' });

    await processor.process(job(deployment()));

    expect(add).not.toHaveBeenCalled();
  });

  it('still writes the deployment when the queue refuses the reading', async () => {
    // The write has already happened, and the scheduled probe reads this
    // environment within the interval anyway.
    const { processor, store } = build();
    const failing = {
      getJob: vi.fn().mockRejectedValue(new Error('redis is away')),
      add: vi.fn(),
    } as unknown as Queue;
    const processorWithBadQueue = new IngestProcessor(
      { upsertDeployments: store.upsertDeployments } as never,
      failing,
    );

    const result = await processorWithBadQueue.process(job(deployment()));

    expect(result).toMatchObject({ written: 1, probe: false });
  });
});
