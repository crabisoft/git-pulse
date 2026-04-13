import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VersionChangeEntry, VersionHistory } from '@repo/shared';
import { VersionTimeline } from './VersionTimeline';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { versionHistory: vi.fn() },
}));

const { api } = await import('../api');

function entry(over: Partial<VersionChangeEntry> = {}): VersionChangeEntry {
  return {
    version: '1.4.2',
    observedAt: '2026-08-01T10:00:00.000Z',
    until: null,
    deploymentId: 'dep-1',
    ref: 'v1.4.2',
    ...over,
  };
}

function history(over: Partial<VersionHistory> = {}): VersionHistory {
  return {
    changes: {
      items: [entry()],
      page: { total: 1, limit: 25, offset: 0, hasMore: false },
    },
    firstSeenAt: '2026-07-01T08:00:00.000Z',
    ...over,
  };
}

function renderTimeline() {
  return render(
    <MemoryRouter>
      <VersionTimeline
        sourceId="src-1"
        slug="acme"
        repo="acme/api"
        environment="prod"
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.versionHistory).mockResolvedValue(history());
});

describe('the timeline of one environment', () => {
  it('asks for the pair it was opened on', async () => {
    renderTimeline();

    await waitFor(() =>
      expect(api.versionHistory).toHaveBeenCalledWith(
        'src-1',
        { repo: 'acme/api', environment: 'prod' },
        {},
        expect.anything(),
      ),
    );
  });

  it('links a version to the deployment that explains it', async () => {
    renderTimeline();

    const link = await screen.findByRole('link', { name: /versions.history.deployment/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('id=dep-1'));
  });

  it('marks a change no deployment explains', async () => {
    // The signal this table exists for, and the reason somebody opens this.
    vi.mocked(api.versionHistory).mockResolvedValue(
      history({
        changes: {
          items: [entry({ deploymentId: null, ref: null })],
          page: { total: 1, limit: 25, offset: 0, hasMore: false },
        },
      }),
    );
    renderTimeline();

    expect(await screen.findByText('versions.history.unexplained')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /versions.history.deployment/ })).toBeNull();
  });

  it('says how long a version held, and leaves the current one open', async () => {
    vi.mocked(api.versionHistory).mockResolvedValue(
      history({
        changes: {
          items: [
            entry({ version: '1.4.2' }),
            entry({
              version: '1.4.1',
              observedAt: '2026-07-28T10:00:00.000Z',
              until: '2026-08-01T10:00:00.000Z',
            }),
          ],
          page: { total: 2, limit: 25, offset: 0, hasMore: false },
        },
      }),
    );
    renderTimeline();

    // The replaced one carries a duration; the newest is still running, so it
    // carries the badge instead of a number that would tick upwards.
    expect(await screen.findByText(/versions.history.held/)).toBeInTheDocument();
    expect(screen.getByText('versions.history.current')).toBeInTheDocument();
  });

  it('says where the record begins, so a short timeline is not read as quiet', async () => {
    renderTimeline();

    expect(await screen.findByText(/versions.history.since/)).toBeInTheDocument();
  });

  it('says an environment has no changes on record rather than showing nothing', async () => {
    vi.mocked(api.versionHistory).mockResolvedValue(
      history({
        changes: { items: [], page: { total: 0, limit: 25, offset: 0, hasMore: false } },
        firstSeenAt: null,
      }),
    );
    renderTimeline();

    expect(await screen.findByText('versions.history.empty')).toBeInTheDocument();
  });
});
