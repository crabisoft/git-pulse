/**
 * What is left of a rate-limit budget, and what that allows.
 *
 * Pure on purpose, like the header reading next door: deciding to drop optional
 * work is the part worth testing, and it must not need a database, a clock or
 * an HTTP client to be exercised.
 */

import type { QuotaOrigin, QuotaSubject } from '@repo/shared';
import type { QuotaSample } from './rate-limit-headers';

/** Whose credentials a series of calls is billed to. */
export interface QuotaSubjectRef {
  kind: QuotaSubject;
  id: string;
}

/** Addresses one subject in the in-memory maps, and one budget in the cache. */
export function subjectKey(subject: QuotaSubjectRef): string {
  return `${subject.kind}:${subject.id}`;
}

/** A ceiling stated by hand, for a provider that meters nothing. */
export interface DeclaredBudget {
  bucket: string;
  limit: number;
  windowSec: number;
}

/** A sample, plus where its ceiling came from. */
export interface Reading {
  sample: QuotaSample;
  origin: QuotaOrigin;
}

/**
 * One call charged to a declared budget.
 *
 * The window is ours to keep here, the provider stating none: it opens on the
 * first call charged and lasts `windowSec`. A call landing after the reset
 * starts a new one at 1 rather than adding to a count nobody would ever clear.
 */
export function countCall(
  held: QuotaSample | undefined,
  budget: DeclaredBudget,
  now: Date,
): QuotaSample {
  const live = held !== undefined && held.resetAt.getTime() > now.getTime();
  return {
    bucket: budget.bucket,
    limit: budget.limit,
    used: live ? held.used + 1 : 1,
    resetAt: live ? held.resetAt : new Date(now.getTime() + budget.windowSec * 1000),
    windowSec: budget.windowSec,
  };
}

/**
 * Share of the budget still available, as a fraction between 0 and 1, over the
 * buckets a subject is metered on. The **scarcest** bucket decides: a run held
 * back by its search quota is held back whatever its REST quota says.
 *
 * A window that has elapsed is ignored rather than read as full — the next
 * window's count is unknown until a call is made in it, and supposing it empty
 * is how one spends a budget that was already gone. Null means nothing is known
 * at all, which is not the same as nothing being left.
 */
export function remainingShare(readings: Reading[], now: Date): number | null {
  let worst: number | null = null;
  for (const { sample } of readings) {
    if (sample.limit <= 0) continue;
    if (sample.resetAt.getTime() <= now.getTime()) continue;
    const share = Math.max(0, sample.limit - sample.used) / sample.limit;
    if (worst === null || share < worst) worst = share;
  }
  return worst;
}

/**
 * Whether the optional calls may still be made — the per-pull-request and
 * per-deployment enrichment, which fan out by an order of magnitude more than
 * the calls carrying the metrics themselves.
 *
 * Unknown consumption allows everything: degrading on a supposition would cost
 * the lead-time segments of every install whose provider meters nothing and has
 * declared no budget either. Which is what declaring one is for.
 */
export function allowsOptionalWork(share: number | null, reservePct: number): boolean {
  if (share === null) return true;
  if (reservePct <= 0) return true;
  return share > reservePct / 100;
}
