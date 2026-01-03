import type { ClassifiedDeployment } from '@repo/shared';

/**
 * How many deployments one run may file.
 *
 * Each one costs a comparison and, on a history the merge commits say nothing
 * about, a call per commit on top. A cap is what keeps a first run over a busy
 * month from spending a source's whole rate-limit budget in one go — and it
 * loses nothing: the deployments stay in the store, and the next cycle picks up
 * where this one stopped.
 */
export const ARCHIVE_BATCH = 25;

/** What a run is going to do, before it does any of it. */
export interface PendingSelection {
  /** The deployments to file, oldest first. */
  targets: ClassifiedDeployment[];
  /** Already filed — what the run costs nothing for. */
  known: number;
  /** Over the cap, left for the next run. */
  deferred: number;
}

/**
 * The deployments a run should file, out of everything the window holds.
 *
 * Successful ones only: a failed deployment carried nothing to the environment,
 * and the comparison it would produce describes what was attempted rather than
 * what ran. It is also what the next successful deployment is compared against —
 * so filing failures would make every one of them look empty and every success
 * look twice as large.
 *
 * Oldest first, which matters when there are more than the cap allows: the
 * oldest are the ones closest to falling out of the store, and a changelog that
 * is never going to be computable again is worth more than one whose commits
 * are still a call away.
 */
export function selectPending(
  deployments: ClassifiedDeployment[],
  filed: Set<string>,
  limit: number = ARCHIVE_BATCH,
): PendingSelection {
  const pending = deployments
    .filter((d) => d.status === 'success' && !filed.has(d.id))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return {
    targets: pending.slice(0, limit),
    known: deployments.filter((d) => filed.has(d.id)).length,
    deferred: Math.max(0, pending.length - limit),
  };
}
