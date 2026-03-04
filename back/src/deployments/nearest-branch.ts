import type { Branch } from '@repo/shared';
import type { RefCommit } from '../sources/connectors/source-connector.interface';

/**
 * How many branches one resolution may compare against.
 *
 * Each candidate costs a call, and this runs for deployments the archive would
 * otherwise file empty — a repo with two hundred branches must not turn one
 * empty changelog into two hundred requests. Twelve is enough to hold the
 * default branch and a release line's recent siblings, which is where the
 * answer is when there is one.
 */
export const NEAREST_CANDIDATES = 12;

/** A branch, and the commit it last shared with the deployed ref. */
export interface BranchBase {
  branch: string;
  isDefault: boolean;
  /** Null when the platform would not compare the two. */
  base: RefCommit | null;
}

/**
 * The branches worth comparing a deployed ref against, in the order to spend
 * calls on them.
 *
 * The deployed ref itself is dropped — a branch cannot have parted from itself
 * — and the default branch comes first, since it is the answer whenever no
 * closer one is found and the one candidate that must never be cut by the cap.
 * Siblings of the same line come next: `release/2026.07.11` was almost always
 * cut where `release/2026.07.10` was, and a repo that has more branches than
 * the cap allows usually has them under a handful of prefixes.
 */
export function candidateBranches(
  branches: readonly Branch[],
  ref: string,
  limit: number = NEAREST_CANDIDATES,
): Array<{ branch: string; isDefault: boolean }> {
  const prefix = ref.includes('/') ? ref.slice(0, ref.lastIndexOf('/') + 1) : null;
  const rank = (branch: Branch) => {
    if (branch.isDefault) return 0;
    return prefix && branch.name.startsWith(prefix) ? 1 : 2;
  };

  return branches
    .filter((branch) => branch.name !== ref)
    .map((branch, index) => ({ branch, index }))
    // Ranked, then by the order the platform listed them: two branches of the
    // same rank are not ours to order, and a stable one keeps a run reproducible.
    .sort((a, b) => rank(a.branch) - rank(b.branch) || a.index - b.index)
    .slice(0, limit)
    .map(({ branch }) => ({ branch: branch.name, isDefault: branch.isDefault }));
}

/**
 * The branch the deployed ref parted from most recently, out of what was found.
 *
 * "Most recent merge base" is the whole rule: of every branch the ref shares
 * history with, the one whose common commit is the youngest is the one it grew
 * out of. A branch that already holds the ref is not that branch — its base is
 * the ref's own tip, and comparing against it shows nothing, which is the state
 * this exists to get out of.
 *
 * Undated bases are unusable rather than merely awkward: recency is the
 * question, and a candidate that cannot be placed in time cannot answer it.
 * They lose to every dated one, and win nothing among themselves.
 */
export function nearestBranch(
  candidates: readonly BranchBase[],
  /** The deployed ref's own commit, when the platform resolved it. */
  tip: RefCommit | null,
): string | null {
  const usable = candidates.filter(
    (candidate) =>
      candidate.base?.committedAt && (!tip || candidate.base.sha !== tip.sha),
  );

  let best: BranchBase | null = null;
  for (const candidate of usable) {
    if (!best) {
      best = candidate;
      continue;
    }
    const when = candidate.base!.committedAt!;
    const bestWhen = best.base!.committedAt!;
    // The default branch takes a tie: two branches cut at the same commit are
    // equally near, and the one the repository itself points at is the one a
    // reader can be expected to know.
    if (when > bestWhen || (when === bestWhen && candidate.isDefault && !best.isDefault)) {
      best = candidate;
    }
  }
  return best?.branch ?? null;
}
