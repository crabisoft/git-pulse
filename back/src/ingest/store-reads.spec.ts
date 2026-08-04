import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { StoreService } from './store.service';

const SINCE = '2026-06-01T00:00:00.000Z';

/** One stored row, with only the columns a read maps back. */
function row(externalId: string, repo: string, createdAt: string) {
  return {
    externalId,
    repo,
    environment: 'prod',
    ref: 'main',
    status: 'success',
    createdAt: new Date(createdAt),
    environmentUrl: null,
    url: null,
  };
}

/**
 * The store, with the deployment queries recorded rather than run. Each call
 * answers `rows`, so what is asserted is the query — the shape of the read is
 * the whole behaviour here.
 */
function service(rows: ReturnType<typeof row>[] = []) {
  const queries: Array<Record<string, unknown>> = [];
  const prisma = {
    storedDeployment: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        queries.push(args);
        return rows;
      }),
    },
    $transaction: (ops: unknown[]) => Promise.all(ops),
  } as unknown as PrismaService;
  return { store: new StoreService(prisma), queries };
}

describe('StoreService.readDeployments', () => {
  it('reads the whole window in one query when a date bounds it', async () => {
    const { store, queries } = service([row('d-1', 'api', '2026-07-20T10:00:00Z')]);

    await store.readDeployments('src', ['api', 'web'], SINCE);

    // One query for both repos, and — the point of the change — no ceiling on
    // what it brings back.
    expect(queries).toHaveLength(1);
    expect(queries[0].where).toEqual({
      sourceId: 'src',
      repo: { in: ['api', 'web'] },
      createdAt: { gte: new Date(SINCE) },
    });
    expect(queries[0].take).toBeUndefined();
  });

  it('keeps the per-repo ceiling when nothing bounds it', async () => {
    const { store, queries } = service();

    await store.readDeployments('src', ['api', 'web']);

    // The board of the present: the most recent slice per repo, at the cost a
    // live source would answer at.
    expect(queries).toHaveLength(2);
    expect(queries[0].take).toBe(30);
    expect(queries[0].where).toEqual({ sourceId: 'src', repo: 'api' });
  });

  it('asks for nothing when no repo is in scope', async () => {
    const { store, queries } = service();

    expect(await store.readDeployments('src', [], SINCE)).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it('maps a bounded read back to deployments, newest first', async () => {
    const { store } = service([
      row('d-2', 'api', '2026-07-20T10:00:00Z'),
      row('d-1', 'api', '2026-06-02T10:00:00Z'),
    ]);

    const deployments = await store.readDeployments('src', ['api'], SINCE);

    expect(deployments.map((d) => d.id)).toEqual(['d-2', 'd-1']);
    expect(deployments[0].createdAt).toBe('2026-07-20T10:00:00.000Z');
  });
});

/** A stored pull request, with only the columns a read maps back. */
function prRow(body: string | null) {
  return {
    externalId: 'gh:api:42',
    repo: 'api',
    number: 42,
    title: 'Ajoute la pagination',
    body,
    state: 'open',
    author: 'alice',
    url: 'https://github.com/acme/api/pull/42',
    repoUrl: 'https://github.com/acme/api',
    headRef: 'feat/pagination',
    openedAt: new Date('2026-07-20T08:00:00Z'),
    updatedAt: new Date('2026-07-25T08:00:00Z'),
    mergedAt: null as Date | null,
    reviewers: 2,
    firstCommitAt: null,
    firstReviewAt: null,
    seenAt: new Date('2026-07-27T12:00:00Z'),
  };
}

function prStore(rows: ReturnType<typeof prRow>[]) {
  const prisma = {
    storedPullRequest: { findMany: vi.fn(async () => rows) },
    $transaction: (ops: unknown[]) => Promise.all(ops),
  } as unknown as PrismaService;
  return new StoreService(prisma);
}

/** The same row, merged — what a lead-time sample is read from. */
function mergedRow(body: string | null) {
  return { ...prRow(body), state: 'merged', mergedAt: new Date('2026-07-26T10:00:00Z') };
}

describe('StoreService.readPullRequests', () => {
  it('hands back the description, so a stored source feeds the rules a live one does', async () => {
    const prs = await prStore([prRow('Closes OPS-42')]).readPullRequests('src', ['api']);

    expect(prs[0].body).toBe('Closes OPS-42');
  });

  it('reads a row no feed ever told a description as having none', async () => {
    // A row written before the column existed. Empty rather than null: to a rule
    // matching against it, a description nobody wrote and an empty one are the
    // same absence of a key.
    const prs = await prStore([prRow(null)]).readPullRequests('src', ['api']);

    expect(prs[0].body).toBe('');
  });
});

describe('StoreService.readMergedPullRequests', () => {
  it('hands back the description too, so DORA reads what the board reads', async () => {
    const prs = await prStore([mergedRow('Closes OPS-42')]).readMergedPullRequests(
      'src',
      ['api'],
      SINCE,
    );

    expect(prs[0].body).toBe('Closes OPS-42');
  });
});
