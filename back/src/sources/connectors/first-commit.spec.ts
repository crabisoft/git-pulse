import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubConnector } from './github.connector';
import { GitLabConnector } from './gitlab.connector';
import type { ConnectorContext } from './source-connector.interface';

/**
 * Where the coding time starts, read from each platform.
 *
 * Driven through a stubbed transport rather than a mocked client, like the
 * listing-depth suite: what is checked here is which field of a real payload is
 * read and how the rows are reduced, and a mock would only restate the code.
 *
 * Two things this pins, both of which used to differ between the platforms:
 * the **authored** date rather than the committed one, and the **oldest** row
 * rather than the first the endpoint happens to return.
 */

const SINCE = '2026-07-01T00:00:00Z';
const MERGED_AT = '2026-07-10T12:00:00Z';

function contextFor(kind: 'github' | 'gitlab'): ConnectorContext {
  return {
    baseUrl: kind === 'github' ? 'https://github.example.com' : 'https://gitlab.example.com',
    auth: { kind: 'token', token: 'secret' },
    scope: { owner: 'acme' },
    // The enrichment is exactly what is under test here.
    allowsOptionalCalls: () => true,
  };
}

function urlOf(input: unknown): URL {
  return new URL(typeof input === 'string' ? input : String((input as Request).url));
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Deliberately newest-first, so trusting row order would read the wrong one. */
const GITHUB_COMMITS = [
  { commit: { author: { date: '2026-07-09T10:00:00Z' }, committer: { date: '2026-07-09T10:00:00Z' } } },
  // Written first, rebased later: the committed date is the most recent of all.
  { commit: { author: { date: '2026-07-02T08:00:00Z' }, committer: { date: '2026-07-09T18:00:00Z' } } },
  { commit: { author: { date: '2026-07-05T09:00:00Z' }, committer: { date: '2026-07-09T11:00:00Z' } } },
];

const GITLAB_COMMITS = [
  { authored_date: '2026-07-09T10:00:00Z', created_at: '2026-07-09T10:00:00Z' },
  { authored_date: '2026-07-02T08:00:00Z', created_at: '2026-07-09T18:00:00Z' },
  { authored_date: '2026-07-05T09:00:00Z', created_at: '2026-07-09T11:00:00Z' },
];

function serveGitHub() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const path = urlOf(input).pathname;
      if (path.endsWith('/commits')) return json(GITHUB_COMMITS);
      if (path.endsWith('/reviews')) return json([]);
      if (path.endsWith('/pulls')) {
        return json([
          {
            number: 7,
            title: 'Add the thing',
            html_url: 'https://github.example.com/acme/api/pull/7',
            head: { ref: 'feat/thing' },
            created_at: '2026-07-08T09:00:00Z',
            updated_at: MERGED_AT,
            merged_at: MERGED_AT,
          },
        ]);
      }
      return json([]);
    }),
  );
}

function serveGitLab() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const path = urlOf(input).pathname;
      if (path.includes('/commits')) return json(GITLAB_COMMITS);
      if (path.includes('/notes')) return json([]);
      if (path.includes('/merge_requests')) {
        return json([
          {
            iid: 7,
            title: 'Add the thing',
            web_url: 'https://gitlab.example.com/acme/api/-/merge_requests/7',
            source_branch: 'feat/thing',
            created_at: '2026-07-08T09:00:00Z',
            merged_at: MERGED_AT,
          },
        ]);
      }
      return json([]);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('where the coding time starts', () => {
  it('reads the oldest authored date on GitHub, whatever the row order', async () => {
    serveGitHub();

    const [pr] = await new GitHubConnector().listMergedPullRequests(
      contextFor('github'),
      ['api'],
      SINCE,
    );

    // Not the first row (9 July) and not any committed date (9 July too): the
    // branch was written on the 2nd and rebased since.
    expect(pr.firstCommitAt).toBe('2026-07-02T08:00:00.000Z');
  });

  it('reads the oldest authored date on GitLab, not the date the rebase wrote', async () => {
    serveGitLab();

    const [mr] = await new GitLabConnector().listMergedPullRequests(
      contextFor('gitlab'),
      ['api'],
      SINCE,
    );

    // `created_at` mirrors the committed date, which the rebase moved to the
    // 9th. Reading it would have said the work started the day before merging.
    expect(mr.firstCommitAt).toBe('2026-07-02T08:00:00.000Z');
  });

  it('agrees across the two platforms on the same history', async () => {
    serveGitHub();
    const [fromGitHub] = await new GitHubConnector().listMergedPullRequests(
      contextFor('github'),
      ['api'],
      SINCE,
    );
    vi.unstubAllGlobals();
    serveGitLab();
    const [fromGitLab] = await new GitLabConnector().listMergedPullRequests(
      contextFor('gitlab'),
      ['api'],
      SINCE,
    );

    // The whole point: a metric that meant one thing on GitHub and another on
    // GitLab was comparable to nothing.
    expect(fromGitHub.firstCommitAt).toBe(fromGitLab.firstCommitAt);
  });
});
