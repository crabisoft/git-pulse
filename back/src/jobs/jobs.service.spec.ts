import { describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import { CodedException } from '../common/coded-exception';
import { JobsService } from './jobs.service';

const COUNTS = { waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 };

/** A failed job as BullMQ hands it back — only the fields the mapping reads. */
function failed(over: Partial<Job> = {}): Job {
  return {
    id: '1',
    name: 'collect-source',
    data: { sourceId: 'src-1' },
    attemptsMade: 3,
    failedReason: 'connect ECONNREFUSED',
    stacktrace: ['first attempt', 'last attempt'],
    timestamp: Date.parse('2026-07-30T09:00:00Z'),
    finishedOn: Date.parse('2026-07-30T09:01:00Z'),
    ...over,
  } as Job;
}

function queue(over: Partial<Record<keyof Queue, unknown>> = {}) {
  return {
    getJobCounts: vi.fn().mockResolvedValue(COUNTS),
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    isPaused: vi.fn().mockResolvedValue(false),
    getFailed: vi.fn().mockResolvedValue([]),
    getCompleted: vi.fn().mockResolvedValue([]),
    getJob: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as Queue;
}

function service(collection = queue(), ingest = queue()) {
  return { jobs: new JobsService(collection, ingest), collection, ingest };
}

/** The coded body a route would answer with. */
function codeOf(e: unknown): string | undefined {
  return e instanceof CodedException
    ? (e.getResponse() as { code?: string }).code
    : undefined;
}

describe('JobsService.snapshot', () => {
  it('reports both queues, with the next occurrence of a repeatable as a date', async () => {
    const { jobs } = service(
      queue({
        getRepeatableJobs: vi.fn().mockResolvedValue([
          { name: 'collect-all', pattern: '*/15 * * * *', next: Date.parse('2026-07-30T10:15:00Z') },
        ]),
      }),
    );

    const snapshot = await jobs.snapshot();

    expect(snapshot.unreachable).toBeNull();
    expect(snapshot.queues.map((q) => q.name)).toEqual(['collection', 'ingest']);
    expect(snapshot.queues[0].counts).toEqual(COUNTS);
    expect(snapshot.queues[0].repeatables).toEqual([
      { name: 'collect-all', pattern: '*/15 * * * *', nextRunAt: '2026-07-30T10:15:00.000Z' },
    ]);
    // The ingest queue has none, and saying so is not the same as saying nothing.
    expect(snapshot.queues[1].repeatables).toEqual([]);
  });

  it('answers with the reason rather than throwing when Redis does not answer', async () => {
    const { jobs } = service(
      queue({ getJobCounts: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) }),
    );

    const snapshot = await jobs.snapshot();

    expect(snapshot.queues).toEqual([]);
    expect(snapshot.unreachable).toEqual({
      code: 'errors.jobs.unreachable',
      params: { error: 'connect ECONNREFUSED' },
    });
  });
});

describe('JobsService.running', () => {
  const at = (iso: string) => Date.parse(iso);
  /** An in-flight job as BullMQ hands it back — only the mapped fields. */
  const job = (over: Partial<Job> = {}): Job =>
    ({
      id: '1',
      name: 'collect-source',
      data: { sourceId: 'src-1' },
      attemptsMade: 1,
      timestamp: at('2026-07-30T09:00:00Z'),
      ...over,
    }) as Job;

  const inFlight = (over: Partial<Record<keyof Queue, unknown>> = {}) =>
    queue({
      getActive: vi.fn().mockResolvedValue([]),
      getWaiting: vi.fn().mockResolvedValue([]),
      getDelayed: vi.fn().mockResolvedValue([]),
      ...over,
    });

  it('puts what is running before what is queued, oldest first within a state', async () => {
    const { jobs } = service(
      inFlight({
        getActive: vi
          .fn()
          .mockResolvedValue([
            job({ id: 'a-new', processedOn: at('2026-07-30T09:10:00Z') }),
            job({ id: 'a-old', processedOn: at('2026-07-30T09:02:00Z') }),
          ]),
        getWaiting: vi.fn().mockResolvedValue([job({ id: 'w1' })]),
        getDelayed: vi.fn().mockResolvedValue([job({ id: 'd1', delay: 600_000 })]),
      }),
      inFlight(),
    );

    const page = await jobs.running(undefined, { limit: 10, offset: 0 });

    // The one that has been running longest heads the list: that is the one
    // that is either working hard or not finishing at all.
    expect(page.items.map((j) => j.id)).toEqual(['a-old', 'a-new', 'w1', 'd1']);
    expect(page.items.map((j) => j.state)).toEqual(['active', 'active', 'waiting', 'delayed']);
  });

  it('reads a running job as when it started and what it carries', async () => {
    const { jobs } = service(
      inFlight({
        getActive: vi
          .fn()
          .mockResolvedValue([job({ processedOn: at('2026-07-30T09:02:00Z'), progress: 40 })]),
      }),
    );

    const [first] = (await jobs.running('collection', { limit: 10, offset: 0 })).items;

    expect(first).toMatchObject({
      queue: 'collection',
      id: '1',
      name: 'collect-source',
      state: 'active',
      startedAt: '2026-07-30T09:02:00.000Z',
      enqueuedAt: '2026-07-30T09:00:00.000Z',
      scheduledFor: null,
      progress: 40,
      data: { sourceId: 'src-1' },
    });
  });

  it('turns a delay into the date it comes due, which is what is read', async () => {
    const { jobs } = service(
      inFlight({ getDelayed: vi.fn().mockResolvedValue([job({ delay: 900_000 })]) }),
    );

    const [first] = (await jobs.running('collection', { limit: 10, offset: 0 })).items;

    expect(first.scheduledFor).toBe('2026-07-30T09:15:00.000Z');
    expect(first.startedAt).toBeNull();
  });

  it('keeps a progress that is not a number out of the payload', async () => {
    const { jobs } = service(
      inFlight({ getActive: vi.fn().mockResolvedValue([job({ progress: { step: 'repos' } })]) }),
    );

    const [first] = (await jobs.running('collection', { limit: 10, offset: 0 })).items;

    expect(first.progress).toBeNull();
  });

  it('reads back only the queue that was named', async () => {
    const collection = inFlight();
    const ingest = inFlight();
    const { jobs } = service(collection, ingest);

    await jobs.running('ingest', { limit: 10, offset: 0 });

    expect(ingest.getActive).toHaveBeenCalled();
    expect(collection.getActive).not.toHaveBeenCalled();
  });

  it('reports an unreachable Redis as a coded error', async () => {
    const { jobs } = service(
      inFlight({ getActive: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) }),
    );

    await expect(jobs.running(undefined, { limit: 10, offset: 0 })).rejects.toSatisfy(
      (e: unknown) => codeOf(e) === 'errors.jobs.unreachable',
    );
  });
});

describe('JobsService.failures', () => {
  it('merges the queues newest first, and windows what it merged', async () => {
    const at = (iso: string) => Date.parse(iso);
    const { jobs } = service(
      queue({
        getFailed: vi
          .fn()
          .mockResolvedValue([
            failed({ id: 'c1', finishedOn: at('2026-07-30T09:00:00Z') }),
            failed({ id: 'c2', finishedOn: at('2026-07-30T11:00:00Z') }),
          ]),
      }),
      queue({
        getFailed: vi
          .fn()
          .mockResolvedValue([
            failed({ id: 'i1', name: 'ingest-event', finishedOn: at('2026-07-30T10:00:00Z') }),
          ]),
      }),
    );

    const page = await jobs.failures(undefined, { limit: 2, offset: 0 });

    expect(page.items.map((f) => f.id)).toEqual(['c2', 'i1']);
    expect(page.items.map((f) => f.queue)).toEqual(['collection', 'ingest']);
    expect(page.page).toEqual({ total: 3, limit: 2, offset: 0, hasMore: true });
  });

  it('reads back only the queue that was named', async () => {
    const { jobs, collection, ingest } = service();

    await jobs.failures('ingest', { limit: 10, offset: 0 });

    expect(ingest.getFailed).toHaveBeenCalled();
    expect(collection.getFailed).not.toHaveBeenCalled();
  });

  it('keeps the payload and the last stack frame of a failure', async () => {
    const { jobs } = service(queue({ getFailed: vi.fn().mockResolvedValue([failed()]) }));

    const [failure] = (await jobs.failures('collection', { limit: 10, offset: 0 })).items;

    expect(failure).toMatchObject({
      queue: 'collection',
      id: '1',
      name: 'collect-source',
      attemptsMade: 3,
      reason: 'connect ECONNREFUSED',
      // One entry per attempt is kept; the one that gave up is the last.
      stack: 'last attempt',
      failedAt: '2026-07-30T09:01:00.000Z',
      enqueuedAt: '2026-07-30T09:00:00.000Z',
      data: { sourceId: 'src-1' },
    });
  });
});

describe('JobsService.degraded', () => {
  it('keeps the completed runs that gave up on part of their work, and only those', async () => {
    const done = (id: string, warnings: unknown[]) =>
      ({
        ...failed({ id }),
        returnvalue: { sourceId: 'src-1', count: 4, warnings },
      }) as Job;
    const { jobs } = service(
      queue({
        getCompleted: vi
          .fn()
          .mockResolvedValue([
            done('clean', []),
            done('degraded', [{ code: 'errors.collect.ingest', params: { error: 'timeout' } }]),
          ]),
      }),
    );

    const page = await jobs.degraded(undefined, { limit: 10, offset: 0 });

    expect(page.items.map((run) => run.id)).toEqual(['degraded']);
    expect(page.items[0].warnings).toEqual([
      { code: 'errors.collect.ingest', params: { error: 'timeout' } },
    ]);
  });

  it('does not let clean runs eat the window the degraded ones are shown in', async () => {
    const runs = Array.from({ length: 30 }, (_, i) => ({
      ...failed({ id: `run-${i}`, finishedOn: Date.parse('2026-07-30T09:00:00Z') - i }),
      returnvalue: { warnings: i === 29 ? [{ code: 'errors.collect.dora' }] : [] },
    })) as Job[];
    const { jobs } = service(queue({ getCompleted: vi.fn().mockResolvedValue(runs) }));

    const page = await jobs.degraded(undefined, { limit: 10, offset: 0 });

    // The only degraded run is the oldest of thirty: windowing the completed
    // jobs first would have dropped it off the end.
    expect(page.items.map((run) => run.id)).toEqual(['run-29']);
  });

  it('reads nothing into a job that returned no warnings at all', async () => {
    const { jobs } = service(
      queue({ getCompleted: vi.fn().mockResolvedValue([{ ...failed(), returnvalue: null } as Job]) }),
    );

    expect((await jobs.degraded(undefined, { limit: 10, offset: 0 })).items).toEqual([]);
  });
});

describe('JobsService.retry', () => {
  it('puts a failed job back', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const job = { ...failed(), getState: vi.fn().mockResolvedValue('failed'), retry };
    const { jobs } = service(queue({ getJob: vi.fn().mockResolvedValue(job) }));

    await jobs.retry('collection', '1');

    expect(retry).toHaveBeenCalled();
  });

  it('refuses one that is not failed — somebody else already retried it', async () => {
    const retry = vi.fn();
    const job = { ...failed(), getState: vi.fn().mockResolvedValue('active'), retry };
    const { jobs } = service(queue({ getJob: vi.fn().mockResolvedValue(job) }));

    expect(codeOf(await jobs.retry('collection', '1').catch((e) => e))).toBe(
      'errors.jobs.notFailed',
    );
    expect(retry).not.toHaveBeenCalled();
  });

  it('reports a job the retention has already dropped as gone', async () => {
    const { jobs } = service();

    expect(codeOf(await jobs.retry('collection', 'stale').catch((e) => e))).toBe(
      'errors.jobs.notFound',
    );
  });

  it('refuses a queue that does not exist rather than reading a random one', async () => {
    const { jobs } = service();

    expect(codeOf(await jobs.discard('nope', '1').catch((e) => e))).toBe(
      'errors.jobs.unknownQueue',
    );
  });
});
