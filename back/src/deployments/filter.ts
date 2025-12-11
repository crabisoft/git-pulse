import type { ClassifiedDeployment, PipelineStatus } from '@repo/shared';

/** What narrows the list, after the repo scope has already narrowed collection. */
export interface DeploymentFilters {
  /** Environment names, matched exactly. Empty or absent matches every one. */
  environments?: string[];
  statuses?: PipelineStatus[];
  /** All pairs must match, like the DORA dimension filter. */
  dimensions?: Record<string, string>;
}

/**
 * What the filter controls offer. Computed over the whole period, **before**
 * any of the filters apply: narrowing one must never empty the list you pick
 * the next one from, which is the same rule the DORA report follows.
 */
export function vocabularies(deployments: ClassifiedDeployment[]): {
  environments: string[];
  statuses: PipelineStatus[];
  dimensions: Record<string, string[]>;
} {
  const environments = new Set<string>();
  const statuses = new Set<PipelineStatus>();
  const dimensions = new Map<string, Set<string>>();

  for (const deployment of deployments) {
    environments.add(deployment.environment);
    statuses.add(deployment.status);
    for (const [key, value] of Object.entries(deployment.attributes)) {
      const seen = dimensions.get(key);
      if (seen) seen.add(value);
      else dimensions.set(key, new Set([value]));
    }
    // A meta-environment is a membership, not an attribute — offered under its
    // own key so it can be filtered on without inventing one.
    for (const meta of deployment.metaEnvironments) {
      const seen = dimensions.get(META_KEY);
      if (seen) seen.add(meta);
      else dimensions.set(META_KEY, new Set([meta]));
    }
  }

  return {
    environments: [...environments].sort(),
    statuses: [...statuses].sort(),
    dimensions: Object.fromEntries(
      [...dimensions.entries()]
        .map(([key, values]) => [key, [...values].sort()] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

/**
 * The dimension key a meta-environment is filtered under. Prefixed so it cannot
 * collide with an attribute a rule extracted: `meta` is a plausible group name.
 */
export const META_KEY = '@meta';

/** Applies every filter. All of them narrow; none of them widen. */
export function applyFilters(
  deployments: ClassifiedDeployment[],
  filters: DeploymentFilters,
): ClassifiedDeployment[] {
  const environments = new Set(filters.environments ?? []);
  const statuses = new Set(filters.statuses ?? []);
  const dimensions = Object.entries(filters.dimensions ?? {});

  return deployments.filter((deployment) => {
    if (environments.size > 0 && !environments.has(deployment.environment)) return false;
    if (statuses.size > 0 && !statuses.has(deployment.status)) return false;
    return dimensions.every(([key, value]) =>
      key === META_KEY
        ? deployment.metaEnvironments.includes(value)
        : deployment.attributes[key] === value,
    );
  });
}

/** Most recent first: a deployments page is read from the top. */
export function byMostRecent(
  a: ClassifiedDeployment,
  b: ClassifiedDeployment,
): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/**
 * The deployment a given one should be compared against: the most recent
 * **successful** one of the same repo and environment that landed before it.
 *
 * Successful on purpose — comparing against a failed deployment would report
 * what was attempted rather than what is running, and a run of failures would
 * make every one of them look empty.
 */
export function previousDeployment(
  deployments: ClassifiedDeployment[],
  target: ClassifiedDeployment,
): ClassifiedDeployment | null {
  const at = new Date(target.createdAt).getTime();
  const candidates = deployments.filter(
    (d) =>
      d.id !== target.id &&
      d.repo === target.repo &&
      d.environment === target.environment &&
      d.status === 'success' &&
      new Date(d.createdAt).getTime() <= at,
  );
  // Ties on the same instant are possible; `sort` is stable, so the provider's
  // own ordering decides rather than this function inventing one.
  return candidates.sort(byMostRecent)[0] ?? null;
}
