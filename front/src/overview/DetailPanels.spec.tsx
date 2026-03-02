import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardLive, PullRequest } from '@repo/shared';
import { DetailPanels } from './DetailPanels';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { live: vi.fn() },
}));

const { api } = await import('../api');

const NOW = '2026-07-31T12:00:00.000Z';

function pullRequest(createdAt: string, over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: `pr-${createdAt}`,
    repo: 'acme/api',
    repoUrl: 'https://example.test/acme/api',
    number: 1,
    title: 'Add the thing',
    author: 'someone',
    state: 'open',
    url: 'https://example.test/acme/api/1',
    headRef: 'feat/thing',
    reviewers: 1,
    createdAt,
    updatedAt: createdAt,
    mergedAt: null,
    ageHours: 1,
    tickets: [],
    ...over,
  };
}

function live(pullRequests: PullRequest[]): DashboardLive {
  const empty = { total: 0, limit: 25, offset: 0, hasMore: false };
  return {
    sourceId: 'src-1',
    pullRequests: { items: pullRequests, page: { ...empty, total: pullRequests.length } },
    pipelines: { items: [], page: empty },
    environments: { items: [], page: empty },
    repos: ['acme/api'],
    summary: {} as DashboardLive['summary'],
    mode: 'stored',
    syncedAt: NOW,
    warnings: [],
  };
}

async function openPrs() {
  render(<DetailPanels sourceId="src-1" repos={[]} staleHours={72} />);
  await userEvent.click(screen.getByText('overview.details.prs'));
}

beforeEach(() => {
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the open pull requests', () => {
  it('reads an age under the hour in minutes, not as a fraction', async () => {
    // A bare hour count said "0.7" for a PR opened forty minutes ago, which is
    // not a duration anybody reads.
    vi.mocked(api.live).mockResolvedValue(live([pullRequest('2026-07-31T11:20:00.000Z')]));

    await openPrs();

    expect(await screen.findByText('40m')).toBeInTheDocument();
  });

  it('reads a long-open one in days, the same way the control room does', async () => {
    vi.mocked(api.live).mockResolvedValue(live([pullRequest('2026-07-28T08:00:00.000Z')]));

    await openPrs();

    expect(await screen.findByText('3d 4h')).toBeInTheDocument();
  });

  it('keeps the hours beside the day count on a mid-range one', async () => {
    vi.mocked(api.live).mockResolvedValue(live([pullRequest('2026-07-31T06:30:00.000Z')]));

    await openPrs();

    expect(await screen.findByText('5h 30m')).toBeInTheDocument();
  });
});
