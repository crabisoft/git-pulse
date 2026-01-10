import type { DashboardEnvironment } from '@repo/shared';

/**
 * Where an environment lands when the dimension being grouped on says nothing
 * about it. Empty rather than a label: the page translates it, and a sentinel
 * that reads like a value would sort among the real ones.
 */
export const UNCLASSIFIED = '';

export interface EnvironmentGroup {
  /** The dimension value, or UNCLASSIFIED. */
  key: string;
  environments: DashboardEnvironment[];
  /** How many of them need attention — what the group header counts. */
  alerts: number;
}

/**
 * Folds the environments onto one dimension.
 *
 * With rules extracting a client and an app, a flat list of environments is
 * one row per crossing — thirty of them for ten clients and three apps, which
 * is a list nobody reads. Folding it on whichever dimension is being asked
 * about is what keeps the board legible.
 *
 * An environment the dimension says nothing about is kept, in a group of its
 * own placed last: dropping it would hide the rule that is missing, and that
 * is the one thing the reader could act on.
 */
export function groupEnvironments(
  environments: DashboardEnvironment[],
  dimension: string | null,
): EnvironmentGroup[] {
  if (!dimension) {
    return environments.length === 0 ? [] : [toGroup(UNCLASSIFIED, environments)];
  }

  const buckets = new Map<string, DashboardEnvironment[]>();
  for (const env of environments) {
    const key = env.attributes[dimension] ?? UNCLASSIFIED;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(env);
    else buckets.set(key, [env]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => byValueThenGap(a, b))
    .map(([key, items]) => toGroup(key, items));
}

/** Below this many rows a board reads fine flat, and folding it hides things. */
export const GROUPING_THRESHOLD = 8;

/**
 * What to fold on before anybody has chosen.
 *
 * The coarsest dimension — the one with the fewest distinct values. It is the
 * one that shortens a long board most without shattering it: splitting thirty
 * environments by client gives ten groups of three, splitting them by
 * production/pre-production gives two groups worth reading. Ties go to the
 * first key, which the API sorts, so the same data always folds the same way.
 */
export function defaultGroupBy(
  dimensions: Record<string, string[]>,
  environmentCount: number,
): string | null {
  if (environmentCount <= GROUPING_THRESHOLD) return null;
  const keys = Object.keys(dimensions).filter((key) => dimensions[key].length > 1);
  if (keys.length === 0) return null;
  return keys.reduce((coarsest, key) =>
    dimensions[key].length < dimensions[coarsest].length ? key : coarsest,
  );
}

function toGroup(key: string, environments: DashboardEnvironment[]): EnvironmentGroup {
  return {
    key,
    environments,
    alerts: environments.filter((env) => env.lastStatus === 'failed').length,
  };
}

/** Alphabetical, with the unclassified group last — it is a gap, not a value. */
function byValueThenGap(a: string, b: string): number {
  if (a === UNCLASSIFIED) return 1;
  if (b === UNCLASSIFIED) return -1;
  return a.localeCompare(b);
}
