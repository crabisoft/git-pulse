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
 * An environment somebody wrote down, which no deployment need ever mention.
 *
 * It earns a row of its own: an appliance at a customer's site is an
 * environment in every sense the reader cares about — it runs a version, it can
 * be reached — and the only thing it lacks is a deployment this install ever
 * saw.
 */
export interface DeclaredEnvironment {
  /** Empty when it belongs to no repo. */
  repo: string;
  environment: string;
  attributes: Record<string, string>;
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
export function foldEnvironments(
  deployments: DimensionedDeployment[],
  declared: DeclaredEnvironment[] = [],
): DashboardEnvironment[] {
  const byName = new Map<string, DimensionedDeployment[]>();
  for (const deployment of deployments) {
    const bucket = byName.get(deployment.environment);
    if (bucket) bucket.push(deployment);
    else byName.set(deployment.environment, [deployment]);
  }

  return [
    ...declaredRows(declared, byName),
    ...[...byName.entries()].map(([name, items]) => {
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
        declared: false,
        recent: byDate.slice(-ENVIRONMENT_RECENT_MAX).map((d) => d.status),
      };
    }),
  ].sort(byLastDeploy);
}

/**
 * The declared environments that no deployment accounts for.
 *
 * A declaration whose name the window did deploy to is left out: that row
 * already exists and says more — its repos, its history, its heartbeat. The
 * declaration was not idle there either, it decided the address; it simply has
 * nothing to add to a row built from what actually happened.
 */
function declaredRows(
  declared: DeclaredEnvironment[],
  deployed: Map<string, unknown>,
): DashboardEnvironment[] {
  const unseen = declared.filter((entry) => !deployed.has(entry.environment));
  // One row per name: the same environment may be declared under two repos, and
  // the dashboard folds environments by name whatever their repo.
  return [...new Map(unseen.map((entry) => [entry.environment, entry])).values()].map((entry) => ({
    name: entry.environment,
    attributes: entry.attributes,
    metaEnvironments: [],
    repos: entry.repo ? [entry.repo] : [],
    deployments: 0,
    lastDeployAt: null,
    lastStatus: null,
    ref: null,
    declared: true,
    recent: [],
  }));
}

/**
 * Most recently deployed first, and the declared environments after all of
 * them: a row with no deployment has no place on a timeline, and sorting it as
 * though it were infinitely old is the only honest end to put it.
 */
function byLastDeploy(a: DashboardEnvironment, b: DashboardEnvironment): number {
  if (a.lastDeployAt === null || b.lastDeployAt === null) {
    return (a.lastDeployAt === null ? 1 : 0) - (b.lastDeployAt === null ? 1 : 0);
  }
  return msOf(b.lastDeployAt) - msOf(a.lastDeployAt);
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
