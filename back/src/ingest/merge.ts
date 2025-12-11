/**
 * How an incoming reading merges into the stored one.
 *
 * Pure on purpose, like the quota pressure next door: the same row is written by
 * two feeds (the open listing and the merged one), from two transports (the
 * scheduled synchronisation and the webhooks), and in an order nobody controls.
 * Which value wins is the one thing here worth testing, and it must not need a
 * database, a clock or an HTTP client to be exercised.
 */

import type {
  Deployment,
  MergedPullRequest,
  Pipeline,
  PipelineStatus,
  PullRequest,
  PullRequestState,
} from '@repo/shared';

/** The columns a feed writes on a stored pull request. */
export interface PullRequestRow {
  repo: string;
  number: number;
  title: string;
  state: PullRequestState;
  author: string | null;
  url: string;
  repoUrl: string | null;
  headRef: string;
  openedAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  reviewers: number;
  firstCommitAt: Date | null;
  firstReviewAt: Date | null;
  seenAt: Date;
}

export interface PipelineRow {
  repo: string;
  externalId: string;
  repoUrl: string | null;
  ref: string;
  status: PipelineStatus;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  durationSec: number | null;
  seenAt: Date;
}

export interface DeploymentRow {
  repo: string;
  externalId: string;
  environment: string;
  ref: string;
  status: PipelineStatus;
  environmentUrl: string | null;
  createdAt: Date;
  seenAt: Date;
}

/**
 * How settled a status is. A run only moves forward — a deployment that
 * succeeded does not go back to pending — so a reading that knows less than
 * what is stored describes an earlier moment, whatever order it arrived in.
 *
 * `unknown` sits at the bottom on purpose: it is what a connector reports when
 * the status call was given up under the quota reserve, and a degraded run must
 * not erase what a full one established.
 */
const STATUS_RANK: Record<PipelineStatus, number> = {
  unknown: 0,
  pending: 1,
  running: 2,
  success: 3,
  failed: 3,
  canceled: 3,
  skipped: 3,
};

/** The more settled of the two, the incoming one winning a tie. */
export function laterStatus(stored: PipelineStatus | undefined, incoming: PipelineStatus): PipelineStatus {
  if (stored === undefined) return incoming;
  return STATUS_RANK[incoming] >= STATUS_RANK[stored] ? incoming : stored;
}

/**
 * A pull request as the open listing reports it. Null says the reading is older
 * than what is stored and has nothing to add — a webhook delivered late, or a
 * synchronisation that overlapped one.
 *
 * The lead-time segments are never touched here: this feed does not report them,
 * and writing their absence would undo the merged feed's work.
 */
export function mergeOpenPullRequest(
  stored: PullRequestRow | undefined,
  incoming: PullRequest,
  seenAt: Date,
): PullRequestRow | null {
  const updatedAt = new Date(incoming.updatedAt);
  if (stored && stored.updatedAt.getTime() > updatedAt.getTime()) return null;

  // A merge already recorded is a fact this listing cannot revoke: it only ever
  // reports open pull requests, so it has nothing to say about one that closed.
  const mergedAt = incoming.mergedAt ? new Date(incoming.mergedAt) : (stored?.mergedAt ?? null);
  return {
    repo: incoming.repo,
    number: incoming.number,
    title: incoming.title,
    state: settledState(incoming.state, mergedAt),
    author: incoming.author,
    url: incoming.url,
    repoUrl: incoming.repoUrl,
    headRef: incoming.headRef,
    openedAt: new Date(incoming.createdAt),
    updatedAt,
    mergedAt,
    reviewers: incoming.reviewers,
    firstCommitAt: stored?.firstCommitAt ?? null,
    firstReviewAt: stored?.firstReviewAt ?? null,
    seenAt,
  };
}

/**
 * A pull request as the merged listing reports it. Never stale: what it carries
 * — the merge and the timestamps around it — are settled facts, where the open
 * listing reports a state that moves.
 *
 * It reports no author, no reviewer count and no repository URL, so those are
 * kept from whatever the open feed already wrote rather than blanked.
 */
export function mergeMergedPullRequest(
  stored: PullRequestRow | undefined,
  incoming: MergedPullRequest,
  seenAt: Date,
): PullRequestRow {
  const mergedAt = new Date(incoming.mergedAt);
  // This feed states no `updatedAt` of its own — the merge is the last change it
  // knows of. Never lowering the stored one keeps the open feed's guard honest.
  const updatedAt =
    stored && stored.updatedAt.getTime() > mergedAt.getTime() ? stored.updatedAt : mergedAt;

  return {
    repo: incoming.repo,
    number: incoming.number,
    title: incoming.title,
    state: 'merged',
    author: stored?.author ?? null,
    url: incoming.url,
    repoUrl: stored?.repoUrl ?? null,
    headRef: incoming.headRef,
    openedAt: new Date(incoming.openedAt),
    updatedAt,
    mergedAt,
    reviewers: stored?.reviewers ?? 0,
    // Null here means the enrichment was given up under the quota reserve, not
    // that the segment does not exist.
    firstCommitAt: incoming.firstCommitAt
      ? new Date(incoming.firstCommitAt)
      : (stored?.firstCommitAt ?? null),
    firstReviewAt: incoming.firstReviewAt
      ? new Date(incoming.firstReviewAt)
      : (stored?.firstReviewAt ?? null),
    seenAt,
  };
}

export function mergePipeline(
  stored: PipelineRow | undefined,
  incoming: Pipeline,
  seenAt: Date,
): PipelineRow | null {
  const updatedAt = new Date(incoming.updatedAt);
  if (stored && stored.updatedAt.getTime() > updatedAt.getTime()) return null;

  return {
    repo: incoming.repo,
    externalId: incoming.id,
    repoUrl: incoming.repoUrl,
    ref: incoming.ref,
    status: laterStatus(stored?.status, incoming.status),
    url: incoming.url,
    createdAt: new Date(incoming.createdAt),
    updatedAt,
    // A duration is only known once the run finished; keeping the stored one
    // stops a later reading of a still-running job from dropping it.
    durationSec: incoming.durationSec ?? stored?.durationSec ?? null,
    seenAt,
  };
}

/**
 * A deployment carries no update timestamp — only when it was created, which
 * never changes. Its status is what moves, so the settling order is the whole
 * guard here.
 */
export function mergeDeployment(
  stored: DeploymentRow | undefined,
  incoming: Deployment,
  seenAt: Date,
): DeploymentRow {
  return {
    repo: incoming.repo,
    externalId: incoming.id,
    environment: incoming.environment,
    ref: incoming.ref,
    status: laterStatus(stored?.status, incoming.status),
    // A feed never blanks what it does not report: a listing degraded under the
    // reserve reads no URL, which means "not read" and not "there is none".
    environmentUrl: incoming.environmentUrl ?? stored?.environmentUrl ?? null,
    createdAt: new Date(incoming.createdAt),
    seenAt,
  };
}

/** An open state is a contradiction once a merge date is known. */
function settledState(state: PullRequestState, mergedAt: Date | null): PullRequestState {
  if (mergedAt && (state === 'open' || state === 'draft')) return 'merged';
  return state;
}
