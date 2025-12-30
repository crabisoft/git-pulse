import type { JobsOptions } from 'bullmq';

/**
 * How much of a queue's past stays in Redis.
 *
 * Bounded on both ends rather than dropped on success: a run that erased itself
 * leaves the background-jobs page nothing to show, and a job enqueued with no
 * options at all is kept for ever — the collection fan-out did exactly that.
 * Failures are kept deeper than successes because a success is a count and a
 * failure is something somebody has to read.
 */
export const JOB_HISTORY: JobsOptions = {
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

/**
 * What a job gets before it is given up on.
 *
 * Every queue here writes through the same merge rules as a synchronisation, so
 * replaying one settles to the same state as running it once — retrying is safe
 * where it would not be on work that appends. The backoff is generous on
 * purpose: what makes these fail is a platform being unreachable or a rate
 * limit being hit, and neither clears in a second.
 */
export const JOB_RETRIES: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
};

/** What every one-shot job in the install is enqueued with. */
export const JOB_DEFAULTS: JobsOptions = { ...JOB_HISTORY, ...JOB_RETRIES };
