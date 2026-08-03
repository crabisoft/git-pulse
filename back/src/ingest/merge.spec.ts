import { describe, expect, it } from 'vitest';
import type { Deployment, Pipeline } from '@repo/shared';
import type {
  SourceMergedPullRequest,
  SourcePullRequest,
} from '../sources/connectors/source-connector.interface';
import {
  mergeDeployment,
  mergeMergedPullRequest,
  mergeOpenPullRequest,
  mergePipeline,
  type PullRequestRow,
} from './merge';

const SEEN = new Date('2026-07-27T12:00:00Z');

function open(over: Partial<SourcePullRequest> = {}): SourcePullRequest {
  return {
    id: 'gh:api:42',
    number: 42,
    title: 'Ajoute la pagination',
    body: 'Closes OPS-42',
    state: 'open',
    author: 'alice',
    repo: 'api',
    repoUrl: 'https://github.com/acme/api',
    url: 'https://github.com/acme/api/pull/42',
    headRef: 'feat/pagination',
    createdAt: '2026-07-20T08:00:00Z',
    updatedAt: '2026-07-25T08:00:00Z',
    mergedAt: null,
    reviewers: 2,
    ageHours: 168,
    tickets: [],
    ...over,
  };
}

function merged(over: Partial<SourceMergedPullRequest> = {}): SourceMergedPullRequest {
  return {
    id: 'gh:api:42',
    repo: 'api',
    number: 42,
    title: 'Ajoute la pagination',
    body: 'Closes OPS-42',
    url: 'https://github.com/acme/api/pull/42',
    headRef: 'feat/pagination',
    openedAt: '2026-07-20T08:00:00Z',
    firstCommitAt: '2026-07-19T17:00:00Z',
    firstReviewAt: '2026-07-22T09:00:00Z',
    mergedAt: '2026-07-26T10:00:00Z',
    ...over,
  };
}

function pipeline(over: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'gh:api:900',
    repo: 'api',
    repoUrl: 'https://github.com/acme/api',
    ref: 'main',
    status: 'running',
    url: 'https://github.com/acme/api/actions/runs/900',
    createdAt: '2026-07-27T10:00:00Z',
    updatedAt: '2026-07-27T10:05:00Z',
    durationSec: null,
    ...over,
  };
}

function deployment(over: Partial<Deployment> = {}): Deployment {
  return {
    id: 'gh:api:7',
    repo: 'api',
    environment: 'prod',
    ref: 'main',
    status: 'pending',
    createdAt: '2026-07-27T10:00:00Z',
    environmentUrl: null,
    url: null,
    ...over,
  };
}

/** A row as the open feed would have written it. */
function stored(over: Partial<PullRequestRow> = {}): PullRequestRow {
  return {
    repo: 'api',
    number: 42,
    title: 'Ajoute la pagination',
    body: 'Closes OPS-42',
    state: 'open',
    author: 'alice',
    url: 'https://github.com/acme/api/pull/42',
    repoUrl: 'https://github.com/acme/api',
    headRef: 'feat/pagination',
    openedAt: new Date('2026-07-20T08:00:00Z'),
    updatedAt: new Date('2026-07-25T08:00:00Z'),
    mergedAt: null,
    reviewers: 2,
    firstCommitAt: null,
    firstReviewAt: null,
    seenAt: SEEN,
    ...over,
  };
}

describe('mergeOpenPullRequest', () => {
  it('ignores a reading older than what is stored', () => {
    const late = open({ title: 'Ancien titre', updatedAt: '2026-07-24T08:00:00Z' });
    expect(mergeOpenPullRequest(stored(), late, SEEN)).toBeNull();
  });

  it('keeps the lead-time segments it does not report', () => {
    const held = stored({
      firstCommitAt: new Date('2026-07-19T17:00:00Z'),
      firstReviewAt: new Date('2026-07-22T09:00:00Z'),
    });
    const row = mergeOpenPullRequest(held, open({ updatedAt: '2026-07-26T08:00:00Z' }), SEEN);
    expect(row?.firstCommitAt).toEqual(held.firstCommitAt);
    expect(row?.firstReviewAt).toEqual(held.firstReviewAt);
  });

  it('writes the description, being the only feed that reports one', () => {
    const row = mergeOpenPullRequest(stored(), open({ body: 'Closes OPS-9' }), SEEN);
    expect(row?.body).toBe('Closes OPS-9');
  });

  it('does not revoke a merge already recorded', () => {
    // The open listing only ever reports open pull requests, so a stale page of
    // it must not put a merged one back on the dashboard.
    const held = stored({ state: 'merged', mergedAt: new Date('2026-07-26T10:00:00Z') });
    const row = mergeOpenPullRequest(held, open({ updatedAt: '2026-07-26T11:00:00Z' }), SEEN);
    expect(row).toMatchObject({ state: 'merged', mergedAt: held.mergedAt });
  });
});

describe('mergeMergedPullRequest', () => {
  it('keeps what the merged listing does not report', () => {
    const row = mergeMergedPullRequest(stored(), merged(), SEEN);
    expect(row).toMatchObject({
      author: 'alice',
      reviewers: 2,
      repoUrl: 'https://github.com/acme/api',
      state: 'merged',
    });
  });

  it('writes the description, which it reads off the same payload as the open feed', () => {
    // Not among what it keeps: both feeds read it from their listing, so
    // neither is better informed, and an edited description must land.
    const row = mergeMergedPullRequest(stored(), merged({ body: 'Closes OPS-9' }), SEEN);
    expect(row.body).toBe('Closes OPS-9');
  });

  it('never erases an enrichment a degraded run gave up on', () => {
    const held = stored({
      firstCommitAt: new Date('2026-07-19T17:00:00Z'),
      firstReviewAt: new Date('2026-07-22T09:00:00Z'),
    });
    const degraded = merged({ firstCommitAt: null, firstReviewAt: null });
    const row = mergeMergedPullRequest(held, degraded, SEEN);
    expect(row.firstCommitAt).toEqual(held.firstCommitAt);
    expect(row.firstReviewAt).toEqual(held.firstReviewAt);
  });

  it('never lowers the stored update date', () => {
    // Otherwise the open feed's staleness guard would start rejecting fresh
    // readings, the merge date being older than the last known change.
    const held = stored({ updatedAt: new Date('2026-07-27T09:00:00Z') });
    const row = mergeMergedPullRequest(held, merged(), SEEN);
    expect(row.updatedAt).toEqual(held.updatedAt);
  });

  it('writes a row of its own when nothing is stored yet', () => {
    const row = mergeMergedPullRequest(undefined, merged(), SEEN);
    expect(row).toMatchObject({ state: 'merged', author: null, reviewers: 0, repoUrl: null });
  });
});

describe('mergePipeline', () => {
  it('ignores a reading older than what is stored', () => {
    const held = mergePipeline(undefined, pipeline({ updatedAt: '2026-07-27T10:30:00Z' }), SEEN);
    expect(mergePipeline(held!, pipeline(), SEEN)).toBeNull();
  });

  it('does not let an unknown status overwrite a settled one', () => {
    const held = mergePipeline(undefined, pipeline({ status: 'success' }), SEEN);
    const row = mergePipeline(
      held!,
      pipeline({ status: 'unknown', updatedAt: '2026-07-27T10:10:00Z' }),
      SEEN,
    );
    expect(row?.status).toBe('success');
  });

  it('keeps a duration a later reading no longer carries', () => {
    const held = mergePipeline(undefined, pipeline({ durationSec: 312 }), SEEN);
    const row = mergePipeline(
      held!,
      pipeline({ durationSec: null, updatedAt: '2026-07-27T10:10:00Z' }),
      SEEN,
    );
    expect(row?.durationSec).toBe(312);
  });
});

describe('mergeDeployment', () => {
  it('follows a status that settles', () => {
    const held = mergeDeployment(undefined, deployment(), SEEN);
    expect(mergeDeployment(held, deployment({ status: 'success' }), SEEN).status).toBe('success');
  });

  it('ignores an event delivered out of order', () => {
    // A deployment carries no update date: without the settling order, a
    // `pending` event arriving after the `success` one would undo it.
    const held = mergeDeployment(undefined, deployment({ status: 'success' }), SEEN);
    expect(mergeDeployment(held, deployment({ status: 'pending' }), SEEN).status).toBe('success');
  });

  it('keeps an environment URL a later feed does not report', () => {
    // A GitLab deployment hook names the environment but not its address, and a
    // GitHub listing degraded under the reserve reads neither. Null means "not
    // read", so blanking would lose the link at the first such event.
    const held = mergeDeployment(
      undefined,
      deployment({ environmentUrl: 'https://prod.example' }),
      SEEN,
    );
    expect(mergeDeployment(held, deployment({ environmentUrl: null }), SEEN).environmentUrl).toBe(
      'https://prod.example',
    );
  });

  it('takes a URL an earlier feed did not have', () => {
    const held = mergeDeployment(undefined, deployment({ environmentUrl: null }), SEEN);
    expect(
      mergeDeployment(held, deployment({ environmentUrl: 'https://prod.example' }), SEEN)
        .environmentUrl,
    ).toBe('https://prod.example');
  });

  it('holds on to where the deployment itself is read, both ways', () => {
    // The same reasoning as the environment's address, and the same feeds: a
    // GitHub listing degraded under the reserve reads no status, so no run.
    const run = 'https://github.com/acme/api/actions/runs/42';
    const held = mergeDeployment(undefined, deployment({ url: run }), SEEN);
    expect(mergeDeployment(held, deployment({ url: null }), SEEN).url).toBe(run);
    const blank = mergeDeployment(undefined, deployment({ url: null }), SEEN);
    expect(mergeDeployment(blank, deployment({ url: run }), SEEN).url).toBe(run);
  });
});
