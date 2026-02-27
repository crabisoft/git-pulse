import { ENVIRONMENT_RECENT_MAX, type DashboardEnvironment, type Deployment } from '@repo/shared';

/**
 * A deployment whose environment has been resolved against the rules.
 *
 * The deployment, rather than the name, is the unit that carries a
 * classification: a rule confined to a repo makes one environment name mean
 * different things from one repo to the next, and only a deployment knows
 * which repo it came from.
 */
export interface DimensionedDeployment extends Deployment {
  attributes: Record<string, string>;
  metaEnvironments: string[];
}

/**
 * One row per environment name, most recently deployed first.
 *
 * A row can span several repos, and they may not classify alike. The row
 * claims everything its deployments say that none of them contradicts — an
 * attribute two repos answer differently is no more the environment's than
 * either answer is, but one only a single repo answers is still an answer.
 *
 * Which is why this takes deployments rather than rows: filter them and fold
 * again, and the row narrows to what is left, repos, counts and last
 * deployment together. Narrowing a row after the fact would leave it counting
 * deployments it no longer describes.
 */
export function foldEnvironments(deployments: DimensionedDeployment[]): DashboardEnvironment[] {
  const byName = new Map<string, DimensionedDeployment[]>();
  for (const deployment of deployments) {
    const bucket = byName.get(deployment.environment);
    if (bucket) bucket.push(deployment);
    else byName.set(deployment.environment, [deployment]);
  }

  return [...byName.entries()]
    .map(([name, items]) => {
      // Sorted once, then read from both ends: the newest deployment states
      // what is running, and the tail of the same order is the heartbeat.
      const byDate = [...items].sort((a, b) => msOf(a.createdAt) - msOf(b.createdAt));
      const latest = byDate[byDate.length - 1];
      return {
        name,
        attributes: agreedAttributes(items),
        metaEnvironments: agreedMeta(items),
        repos: [...new Set(items.map((d) => d.repo))].sort(),
        deployments: items.length,
        lastDeployAt: latest.createdAt,
        lastStatus: latest.status,
        ref: latest.ref,
        recent: byDate.slice(-ENVIRONMENT_RECENT_MAX).map((d) => d.status),
      };
    })
    .sort((a, b) => msOf(b.lastDeployAt) - msOf(a.lastDeployAt));
}

/**
 * What the row's deployments say, minus what they disagree about.
 *
 * Only a genuine contradiction drops a key — two deployments answering it
 * differently. A deployment that says nothing about a key contradicts nothing:
 * an environment deployed from two repos, one of which no rule classifies, is
 * still what the rule that did classify it says it is. Treating that silence as
 * disagreement emptied whole rows, which is how a classified environment ended
 * up under "unclassified" on both axes of a grid.
 */
function agreedAttributes(deployments: DimensionedDeployment[]): Record<string, string> {
  const claims = new Map<string, string | null>();
  for (const deployment of deployments) {
    for (const [key, value] of Object.entries(deployment.attributes)) {
      const held = claims.get(key);
      // null marks a key already contradicted; it never comes back.
      if (held === undefined) claims.set(key, value);
      else if (held !== value) claims.set(key, null);
    }
  }
  return Object.fromEntries(
    [...claims.entries()].filter((entry): entry is [string, string] => entry[1] !== null),
  );
}

/**
 * Memberships, unioned for the same reason: a set has no contradicting value,
 * so a deployment that carries none takes nothing away from those that do.
 */
function agreedMeta(deployments: DimensionedDeployment[]): string[] {
  return [...new Set(deployments.flatMap((d) => d.metaEnvironments))].sort();
}

function msOf(iso: string): number {
  return new Date(iso).getTime();
}
