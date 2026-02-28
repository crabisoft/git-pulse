import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  JobFailure,
  JobRunning,
  JobWarning,
  JobsSnapshot,
  Page,
  SourcePublic,
} from '@repo/shared';
import { JobsSettings, inFlightAge, subject } from './JobsSettings';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: {
    jobs: vi.fn(),
    runningJobs: vi.fn(),
    failedJobs: vi.fn(),
    degradedJobs: vi.fn(),
    retryJob: vi.fn(),
    discardJob: vi.fn(),
  },
}));

const { api } = await import('../../api');

const SOURCES = [{ id: 'src-1', name: 'Acme GitLab' } as SourcePublic];

function snapshot(over: Partial<JobsSnapshot> = {}): JobsSnapshot {
  return {
    observedAt: '2026-07-30T10:00:00Z',
    unreachable: null,
    queues: [
      {
        name: 'collection',
        counts: { waiting: 2, active: 1, completed: 40, failed: 3, delayed: 0 },
        repeatables: [
          { name: 'collect-all', pattern: '*/15 * * * *', nextRunAt: '2026-07-30T10:15:00Z' },
        ],
        paused: false,
      },
      {
        name: 'ingest',
        counts: { waiting: 0, active: 0, completed: 12, failed: 1, delayed: 0 },
        repeatables: [],
        paused: false,
      },
    ],
    ...over,
  };
}

function failure(over: Partial<JobFailure> = {}): JobFailure {
  return {
    queue: 'collection',
    id: '42',
    name: 'collect-source',
    attemptsMade: 3,
    reason: 'connect ECONNREFUSED',
    stack: 'at Object.collect',
    failedAt: '2026-07-30T09:30:00Z',
    enqueuedAt: '2026-07-30T09:29:00Z',
    data: { sourceId: 'src-1' },
    ...over,
  };
}

function page<T>(items: T[]): Page<T> {
  return { items, page: { total: items.length, limit: 20, offset: 0, hasMore: false } };
}

function inFlight(over: Partial<JobRunning> = {}): JobRunning {
  return {
    queue: 'collection',
    id: '9',
    name: 'collect-source',
    state: 'active',
    startedAt: '2026-07-30T09:58:00Z',
    enqueuedAt: '2026-07-30T09:57:00Z',
    scheduledFor: null,
    progress: null,
    attemptsMade: 1,
    data: { sourceId: 'src-1' },
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(api.jobs).mockResolvedValue(snapshot());
  vi.mocked(api.runningJobs).mockResolvedValue(page<JobRunning>([]));
  vi.mocked(api.failedJobs).mockResolvedValue(page<JobFailure>([]));
  vi.mocked(api.degradedJobs).mockResolvedValue(page<JobWarning>([]));
  vi.mocked(api.retryJob).mockResolvedValue(undefined);
  vi.mocked(api.discardJob).mockResolvedValue(undefined);
});

describe('JobsSettings', () => {
  it('totals the queues and says when the schedule next fires', async () => {
    render(<JobsSettings sources={SOURCES} />);

    // 3 failed on the collection, 1 on the ingest: the tiles are the install's,
    // not one queue's.
    const failed = await screen.findByText('jobs.count.failed', { selector: '.tile-label' });
    expect(failed.parentElement).toHaveTextContent('4');
    expect(failed.parentElement).toHaveClass('crit');
    expect(screen.getByText(/jobs.nextRun/)).toHaveTextContent('*/15 * * * *');
    // The ingest queue is driven by deliveries, and saying so beats an empty cell.
    expect(screen.getByText('jobs.onDemand')).toBeInTheDocument();
  });

  it('says Redis is unreachable instead of showing counts nobody could read', async () => {
    vi.mocked(api.jobs).mockResolvedValue(
      snapshot({
        queues: [],
        unreachable: { code: 'errors.jobs.unreachable', params: { error: 'ECONNREFUSED' } },
      }),
    );

    render(<JobsSettings sources={SOURCES} />);

    expect(await screen.findByText(/jobs.unreachable/)).toHaveTextContent('ECONNREFUSED');
    expect(screen.queryByText('jobs.queues')).not.toBeInTheDocument();
  });

  it('retries a failure and re-reads what that changed', async () => {
    const user = userEvent.setup();
    vi.mocked(api.failedJobs).mockResolvedValue(page([failure()]));
    render(<JobsSettings sources={SOURCES} />);

    await user.click(await screen.findByRole('button', { name: 'jobs.retry' }));

    expect(api.retryJob).toHaveBeenCalledWith('collection', '42');
    // Retrying moves the job out of the failed set; a list left as it was would
    // still be offering the button.
    await waitFor(() => expect(vi.mocked(api.failedJobs).mock.calls.length).toBeGreaterThan(1));
  });

  it('asks before discarding one, and does nothing until it is confirmed', async () => {
    const user = userEvent.setup();
    vi.mocked(api.failedJobs).mockResolvedValue(page([failure()]));
    render(<JobsSettings sources={SOURCES} />);

    await user.click(await screen.findByRole('button', { name: 'jobs.discard' }));
    expect(api.discardJob).not.toHaveBeenCalled();

    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'jobs.discard' }));
    expect(api.discardJob).toHaveBeenCalledWith('collection', '42');
  });

  it('lists a degraded run for what it gave up on, without offering a retry', async () => {
    vi.mocked(api.degradedJobs).mockResolvedValue(
      page<JobWarning>([
        {
          queue: 'collection',
          id: '7',
          name: 'collect-source',
          finishedAt: '2026-07-30T09:45:00Z',
          data: { sourceId: 'src-1' },
          warnings: [{ code: 'errors.collect.ingest', params: { error: 'timeout' } }],
        },
      ]),
    );

    render(<JobsSettings sources={SOURCES} />);

    expect(await screen.findByText(/errors.collect.ingest/)).toHaveTextContent('timeout');
    // Nothing failed, so there is nothing to put back in a queue.
    expect(screen.queryByRole('button', { name: 'jobs.retry' })).not.toBeInTheDocument();
  });
});

describe('the jobs in flight', () => {
  it('says what a running job is working on, not just that one is running', async () => {
    vi.mocked(api.runningJobs).mockResolvedValue(page([inFlight()]));

    render(<JobsSettings sources={SOURCES} />);

    // The whole point of the panel: the tile says "1 active", this says which
    // source it is reading and for how long.
    expect(await screen.findByText('Acme GitLab')).toBeInTheDocument();
    expect(screen.getByText('jobs.running.states.active')).toBeInTheDocument();
    // Two minutes before the instant the API observed the queues.
    expect(screen.getByText('2m')).toBeInTheDocument();
  });

  it('folds a payload away, and shows none where the subject already said it all', async () => {
    vi.mocked(api.runningJobs).mockResolvedValue(
      page([
        inFlight({ id: 'a', data: { sourceId: 'src-1' } }),
        inFlight({ id: 'b', data: { sourceId: 'src-1', intent: { kind: 'deployment' } } }),
      ]),
    );

    render(<JobsSettings sources={SOURCES} />);

    // One payload carries an intent, the other carries only the source the
    // subject column already resolved.
    const payloads = await screen.findAllByText('jobs.running.payload');
    expect(payloads).toHaveLength(1);
  });

  it('says so plainly when there is nothing in flight', async () => {
    render(<JobsSettings sources={SOURCES} />);

    expect(await screen.findByText('jobs.running.empty')).toBeInTheDocument();
  });
});

describe('inFlightAge', () => {
  const t = ((key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key) as never;
  const now = Date.parse('2026-07-30T10:00:00Z');

  it('measures a running job from when it was picked up', () => {
    expect(inFlightAge(inFlight({ startedAt: '2026-07-30T09:30:00Z' }), now, t)).toBe('30m');
  });

  it('measures a queued one from when it was enqueued, not from a start it has none of', () => {
    const queued = inFlight({
      state: 'waiting',
      startedAt: null,
      enqueuedAt: '2026-07-30T09:45:00Z',
    });
    expect(inFlightAge(queued, now, t)).toBe('15m');
  });

  it('counts down to a delayed job rather than up from its enqueueing', () => {
    const delayed = inFlight({
      state: 'delayed',
      startedAt: null,
      scheduledFor: '2026-07-30T10:10:00Z',
    });
    expect(inFlightAge(delayed, now, t)).toContain('10m');
  });

  it('says a past-due job is imminent rather than counting up from a negative', () => {
    const overdue = inFlight({
      state: 'delayed',
      startedAt: null,
      scheduledFor: '2026-07-30T09:50:00Z',
    });
    expect(inFlightAge(overdue, now, t)).toBe('jobs.running.due');
  });

  it('reads a job that has just started as a second, not as nothing', () => {
    expect(inFlightAge(inFlight({ startedAt: '2026-07-30T10:00:00Z' }), now, t)).toBe('1s');
  });
});

describe('subject', () => {
  const name = (id: string) => (id === 'src-1' ? 'Acme GitLab' : id);

  it('resolves the source a job was working on', () => {
    expect(subject({ sourceId: 'src-1' }, name)).toBe('Acme GitLab');
  });

  it('names the kind of an ingestion alongside it', () => {
    expect(subject({ sourceId: 'src-1', intent: { kind: 'deployment' } }, name)).toBe(
      'Acme GitLab · deployment',
    );
  });

  it('falls back to the id of a source that is no longer configured', () => {
    expect(subject({ sourceId: 'gone' }, name)).toBe('gone');
  });

  it('says nothing rather than guessing at a payload it does not know', () => {
    expect(subject({ whatever: 1 }, name)).toBe('—');
  });
});
