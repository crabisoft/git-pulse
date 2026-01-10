import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChangelogReport,
  DeploymentChangelog,
  DeploymentChangelogSummary,
} from '@repo/shared';
import { ChangelogsPage } from './ChangelogsPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    changelogs: vi.fn(),
    changelog: vi.fn(),
  },
}));

const { api } = await import('../api');

/** The filters live in the address, so the page needs a router around it. */
function renderPage() {
  return render(
    <MemoryRouter>
      <ChangelogsPage sourceId="src-1" />
    </MemoryRouter>,
  );
}

function summary(over: Partial<DeploymentChangelogSummary> = {}): DeploymentChangelogSummary {
  return {
    id: 'log-1',
    deploymentId: 'gh:widget:1',
    repo: 'widget',
    environment: 'prod',
    ref: 'v2.0.0',
    baseRef: 'v1.9.0',
    base: 'previous',
    refUrl: 'https://github.com/acme/widget/tree/v2.0.0',
    baseRefUrl: 'https://github.com/acme/widget/tree/v1.9.0',
    deploymentUrl: null,
    environmentUrl: null,
    status: 'success',
    authors: 2,
    commits: 3,
    unreadable: false,
    generator: 'builtin',
    deployedAt: '2026-03-04T10:00:00Z',
    archivedAt: '2026-03-04T10:15:00Z',
    ...over,
  };
}

function report(over: Partial<ChangelogReport> = {}): ChangelogReport {
  return {
    changelogs: {
      items: [summary()],
      page: { total: 1, limit: 25, offset: 0, hasMore: false },
    },
    repos: ['widget'],
    environments: ['prod'],
    lastArchivedAt: '2026-03-04T10:15:00Z',
    ...over,
  };
}

function detail(): DeploymentChangelog {
  return {
    ...summary(),
    markdown: '## widget — v1.9.0...v2.0.0',
    entries: [
      {
        summary: 'add the login page',
        message: 'feat: add the login page',
        scope: null,
        breaking: false,
        sha: 'aaaaaaa',
        author: 'Ada',
        url: 'https://github.com/acme/widget/commit/aaaaaaa',
        tickets: [],
        pullRequest: null,
      },
    ],
  };
}

beforeEach(() => {
  vi.mocked(api.changelogs).mockResolvedValue(report());
  vi.mocked(api.changelog).mockResolvedValue(detail());
});

describe('ChangelogsPage', () => {
  it('lists what was filed without asking for any of its contents', async () => {
    renderPage();

    expect(await screen.findByText('widget')).toBeInTheDocument();
    expect(screen.getByText('v2.0.0')).toBeInTheDocument();
    // The commits are the heavy half of a record: a table of releases must not
    // pull them for rows nobody opened.
    expect(api.changelog).not.toHaveBeenCalled();
  });

  it('reads one release on request', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'changelogs.read' }));

    expect(await screen.findByText('add the login page')).toBeInTheDocument();
    expect(api.changelog).toHaveBeenCalledWith('src-1', 'gh:widget:1', expect.anything());
  });

  it('tells an archive that has never run from one whose filters match nothing', async () => {
    vi.mocked(api.changelogs).mockResolvedValue(
      report({
        changelogs: { items: [], page: { total: 0, limit: 25, offset: 0, hasMore: false } },
        lastArchivedAt: null,
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('changelogs.neverRun')).toBeInTheDocument());
  });
});
