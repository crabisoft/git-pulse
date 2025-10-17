/**
 * Reading of the rate-limit headers every provider returns. Pure on purpose:
 * the shape of these headers is the one thing here worth testing, and it must
 * not need an HTTP client to be exercised.
 */

/** One reading of a bucket, as a single response described it. */
export interface QuotaSample {
  bucket: string;
  limit: number;
  used: number;
  resetAt: Date;
  windowSec: number | null;
}

/** Receives every sample a connector observes. */
export type QuotaSink = (sample: QuotaSample) => void;

/**
 * Headers as the two clients hand them over: Octokit builds a plain object,
 * gitbeaker a `Record<string, string>`, and both errors carry a `Headers`.
 */
export type HeaderBag = Headers | Record<string, string | number | undefined>;

/**
 * Window length per GitHub bucket, in seconds. The API reports the reset date
 * but never the length, and they differ: search is metered by the minute where
 * core and GraphQL are metered by the hour.
 */
const GITHUB_WINDOW_SEC: Record<string, number> = {
  core: 3600,
  graphql: 3600,
  search: 60,
  code_search: 60,
  integration_manifest: 3600,
  code_scanning_upload: 3600,
  dependency_snapshots: 60,
};

/** GitLab meters one bucket, on a one-minute window. */
const GITLAB_WINDOW_SEC = 60;

/**
 * GitHub sends its counters on every response, unauthenticated ones included,
 * and names the bucket it charged in `x-ratelimit-resource`.
 */
export function githubQuota(headers: HeaderBag): QuotaSample | null {
  const limit = readNumber(headers, 'x-ratelimit-limit');
  const reset = readNumber(headers, 'x-ratelimit-reset');
  if (limit === null || reset === null) return null;

  const bucket = readString(headers, 'x-ratelimit-resource') ?? 'core';
  const used = readNumber(headers, 'x-ratelimit-used');
  const remaining = readNumber(headers, 'x-ratelimit-remaining');
  return {
    bucket,
    limit,
    used: usedFrom(limit, used, remaining),
    resetAt: fromEpochSeconds(reset),
    windowSec: GITHUB_WINDOW_SEC[bucket] ?? null,
  };
}

/**
 * GitLab sends its counters only when rate limiting is enabled — a self-hosted
 * instance with it switched off returns none, which is a null sample rather
 * than a zeroed one: nothing was measured.
 */
export function gitlabQuota(headers: HeaderBag): QuotaSample | null {
  const limit = readNumber(headers, 'ratelimit-limit');
  const reset = readNumber(headers, 'ratelimit-reset');
  if (limit === null || reset === null) return null;

  const observed = readNumber(headers, 'ratelimit-observed');
  const remaining = readNumber(headers, 'ratelimit-remaining');
  return {
    bucket: 'rest',
    limit,
    used: usedFrom(limit, observed, remaining),
    resetAt: fromEpochSeconds(reset),
    windowSec: GITLAB_WINDOW_SEC,
  };
}

/**
 * The count of consumed calls, from whichever counter the provider sent. Both
 * report it directly and also imply it through what is left, so the fallback
 * costs nothing and covers the instances that only send one of the two.
 */
function usedFrom(limit: number, used: number | null, remaining: number | null): number {
  if (used !== null) return Math.max(0, used);
  if (remaining !== null) return Math.max(0, limit - remaining);
  return 0;
}

function fromEpochSeconds(seconds: number): Date {
  return new Date(seconds * 1000);
}

function readString(headers: HeaderBag, name: string): string | undefined {
  const raw = headers instanceof Headers ? headers.get(name) : headers[name];
  if (raw === null || raw === undefined) return undefined;
  const value = String(raw).trim();
  return value === '' ? undefined : value;
}

function readNumber(headers: HeaderBag, name: string): number | null {
  const raw = readString(headers, name);
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
