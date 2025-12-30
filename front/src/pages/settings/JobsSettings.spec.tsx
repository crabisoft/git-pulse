import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobFailure, JobWarning, JobsSnapshot, Page, SourcePublic } from '@repo/shared';
import { JobsSettings, subject } from './JobsSettings';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: {
    jobs: vi.fn(),
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

beforeEach(() => {
  vi.mocked(api.jobs).mockResolvedValue(snapshot());
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
