import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubConnector } from './github.connector';
import { GitLabConnector } from './gitlab.connector';
import type { ConnectorContext } from './source-connector.interface';

/**
 * How deep a listing reads, which is the difference between an ingestion that
 * fills its window and one that costs a whole API budget.
 *
 * Exercised against a stubbed transport rather than a mocked client: what is
 * being checked here is precisely what each SDK does when told to stop — and
 * neither of them stops the way its options suggest. Octokit's `paginate` has no
 * early exit at all, and gitbeaker's `.all()` follows the `next` link until the
 * resource runs out unless `maxPages` travels with a `perPage`. A test against a
 * mock would assert the arguments and miss both.
 */

const SINCE = '2026-07-01T00:00:00Z';

function contextFor(kind: 'github' | 'gitlab'): ConnectorContext {
  return {
    baseUrl: kind === 'github' ? 'https://github.example.com' : 'https://gitlab.example.com',
    auth: { kind: 'token', token: 'secret' },
    scope: { owner: 'acme' },
    // The status/enrichment fan-out is a listing of its own and is covered
    // elsewhere; here it would only drown the pages being counted.
    allowsOptionalCalls: () => false,
  };
}

function urlOf(input: unknown): URL {
  return new URL(typeof input === 'string' ? input : String((input as Request).url));
}

/** Answers each page from `dates`, and records which pages were asked for. */
function serveGitHubPages(dates: Record<number, string[]>): number[] {
  const asked: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      const page = Number(url.searchParams.get('page') ?? '1');
      asked.push(page);
      const body = (dates[page] ?? []).map((created_at, i) => ({
        id: page * 100 + i,
        environment: 'prod',
        ref: 'main',
        created_at,
      }));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return asked;
}

/**
 * Answers full pages for ever, each one advertising a next.
 *
 * The listing gitbeaker would read to the end of time — pages are full on
 * purpose, since `maxPages` is weighed against the items accumulated rather
 * than the pages read, and a short page would slip past it.
 */
function serveEndlessGitLabPages(perPage: number): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      calls += 1;
      const page = Number(url.searchParams.get('page') ?? '1');
      const body = Array.from({ length: perPage }, (_, i) => ({
        id: page * 1000 + i,
        iid: page * 1000 + i,
        ref: 'main',
        status: 'success',
        created_at: '2026-07-20T10:00:00Z',
        updated_at: '2026-07-20T10:00:00Z',
        environment: { id: 7, name: 'prod' },
      }));
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', link: `<${next}>; rel="next"` },
      });
    }),
  );
  return { calls: () => calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('GitHub listing depth', () => {
  it('reads one page when nothing bounds it', async () => {
    // The live path. It answers a request somebody is waiting on, so its cost
    // has to be one call per repo whatever the repo's history.
    const asked = serveGitHubPages({ 1: ['2026-07-20T10:00:00Z', '2026-07-19T10:00:00Z'] });

    const out = await new GitHubConnector().listDeployments(contextFor('github'), ['widget']);

    expect(asked).toEqual([1]);
    expect(out).toHaveLength(2);
  });

  it('keeps paging until it crosses the bound', async () => {
    const asked = serveGitHubPages({
      1: ['2026-07-20T10:00:00Z', '2026-07-15T10:00:00Z'],
      2: ['2026-07-10T10:00:00Z', '2026-06-25T10:00:00Z'],
      3: ['2026-06-01T10:00:00Z'],
    });

    const out = await new GitHubConnector().listDeployments(
      contextFor('github'),
      ['widget'],
      SINCE,
    );

    // Page 2 holds the first row older than the bound, so page 3 is never read.
    expect(asked).toEqual([1, 2]);
    // And that older row is dropped: the page that crosses the bound holds both
    // sides of it, and the caller asked for a window.
    expect(out.map((d) => d.createdAt)).toEqual([
      '2026-07-20T10:00:00Z',
      '2026-07-15T10:00:00Z',
      '2026-07-10T10:00:00Z',
    ]);
  });

  it('stops on an exhausted listing rather than on the bound', async () => {
    // A repository whose whole history is inside the window. Nothing older ever
    // comes back to end the loop, so the empty page has to.
    const asked = serveGitHubPages({ 1: ['2026-07-20T10:00:00Z'], 2: [] });

    const out = await new GitHubConnector().listDeployments(
      contextFor('github'),
      ['widget'],
      SINCE,
    );

    expect(asked).toEqual([1, 2]);
    expect(out).toHaveLength(1);
  });
});

describe('GitLab listing depth', () => {
  it('reads one page when nothing bounds it', async () => {
    // Without `maxPages` this call reads every deployment the project ever had:
    // gitbeaker follows the next link until the resource runs out, and a live
    // view has no reason to pay for a history it does not keep.
    const served = serveEndlessGitLabPages(30);

    const out = await new GitLabConnector().listDeployments(contextFor('gitlab'), ['widget']);

    expect(served.calls()).toBe(1);
    expect(out).toHaveLength(30);
  });

  it('stops at the page ceiling on a listing that never ends', async () => {
    // The bound is a date and the pages are a count: a project busy enough to
    // fill the window with thousands of rows must not spend a whole budget on
    // one listing.
    const served = serveEndlessGitLabPages(100);

    await new GitLabConnector().listDeployments(contextFor('gitlab'), ['widget'], SINCE);

    expect(served.calls()).toBe(20);
  });
});

/** Answers the GraphQL turn with `body`, and every REST call with `rest`. */
function serveGraphQL(body: unknown, rest: unknown[] = []): { graphqlCalls: () => number } {
  let graphqlCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input);
      const isGraphQL = url.pathname.endsWith('/graphql') || init?.method === 'POST';
      if (isGraphQL) graphqlCalls += 1;
      const payload = isGraphQL ? body : rest;
      const status = isGraphQL && body === null ? 502 : 200;
      return new Response(JSON.stringify(payload ?? { errors: [{ message: 'no graphql here' }] }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return { graphqlCalls: () => graphqlCalls };
}

describe('GitHub tag order', () => {
  it('reads the dates and hands the tags back newest first', async () => {
    // The REST listing answers in name order and carries no date at all, which
    // made the predecessor of v1.10.0 come back as v1.9.0.
    serveGraphQL({
      data: {
        repository: {
          refs: {
            nodes: [
              {
                name: 'v1.10.0',
                target: {
                  __typename: 'Commit',
                  oid: 'aaa',
                  committedDate: '2026-06-01T00:00:00Z',
                },
              },
              {
                name: 'v1.9.0',
                target: {
                  __typename: 'Commit',
                  oid: 'bbb',
                  committedDate: '2026-05-01T00:00:00Z',
                },
              },
            ],
          },
        },
      },
    });

    const tags = await new GitHubConnector().listTags(contextFor('github'), 'widget');

    expect(tags.map((tag) => tag.name)).toEqual(['v1.10.0', 'v1.9.0']);
    expect(tags[0]).toMatchObject({ sha: 'aaa', taggedAt: '2026-06-01T00:00:00Z' });
  });

  it('dates an annotated tag by its tagger, and points it at the commit', async () => {
    // Git has two kinds of tag: one points straight at a commit, the other at
    // a tag object that points at the commit. A release is usually the second.
    serveGraphQL({
      data: {
        repository: {
          refs: {
            nodes: [
              {
                name: 'v2.0.0',
                target: {
                  __typename: 'Tag',
                  tagger: { date: '2026-07-04T09:00:00Z' },
                  target: { oid: 'ccc', committedDate: '2026-07-03T08:00:00Z' },
                },
              },
            ],
          },
        },
      },
    });

    const [tag] = await new GitHubConnector().listTags(contextFor('github'), 'widget');

    expect(tag).toEqual({ name: 'v2.0.0', sha: 'ccc', taggedAt: '2026-07-04T09:00:00Z' });
  });

  it('falls back to the listing when the instance answers no GraphQL', async () => {
    // An instance with GraphQL disabled still gets its tags — in the order it
    // lists them, undated, which is exactly what it got before any of this.
    const served = serveGraphQL(null, [{ name: 'v1.0.0', commit: { sha: 'ddd' } }]);

    const tags = await new GitHubConnector().listTags(contextFor('github'), 'widget');

    expect(served.graphqlCalls()).toBeGreaterThan(0);
    expect(tags).toEqual([{ name: 'v1.0.0', sha: 'ddd', taggedAt: null }]);
  });
});
