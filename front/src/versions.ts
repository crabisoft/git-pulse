/**
 * What a reading says about the deployment it sits beside.
 *
 * `unknown` is the honest answer far more often than one would like: a ref is a
 * branch name or a commit sha as often as it is a tag, and neither states a
 * version. Saying so beats guessing — a wrong "differs" reads as a failed
 * deployment and sends somebody looking into an incident that never happened.
 */
export type VersionAgreement = 'match' | 'differs' | 'unknown';

/** The least a row has to state for a current reading to be placed against it. */
export interface DeploymentRow {
  id: string;
  repo: string;
  environment: string;
  createdAt: string;
}

/**
 * Which rows may show the **current** version of their environment.
 *
 * The newest deployment of each (repo, environment) in the list, and nothing
 * else. On any older row the current reading would be plainly false — something
 * newer went out since, and what the environment answers now is that newer
 * thing's doing.
 *
 * This is a fallback and never a replacement: a deployment with a frozen row
 * has a version that was confirmed *for it*, which is a stronger claim than
 * anything this can offer, and the page must prefer it. What this covers is the
 * history no probe will ever reach — everything deployed before the rules
 * existed — where the alternative is a column that is blank for ever.
 */
export function newestPerEnvironment(rows: readonly DeploymentRow[]): Set<string> {
  const newest = new Map<string, DeploymentRow>();
  for (const row of rows) {
    const key = `${row.repo}\u0000${row.environment}`;
    const held = newest.get(key);
    if (!held || row.createdAt > held.createdAt) newest.set(key, row);
  }
  return new Set([...newest.values()].map((row) => row.id));
}

/**
 * The release a string states, or null when it states none.
 *
 * A tag is `v1.4.2`, `release-1.4.2`, `1.4.2-rc1`; a version read from an
 * endpoint is `1.4.2` or `1.4.2+build.87`. What the two have in common is a
 * dotted number, and that is all this looks for — comparing the rest would be
 * comparing naming conventions rather than releases.
 *
 * At least one dot required: a bare `87` is a build counter far more often than
 * a release, and a branch called `feature-2` would otherwise state a version.
 */
export function releaseIn(text: string | null): string | null {
  if (!text) return null;
  return /\d+(?:\.\d+)+/.exec(text)?.[0] ?? null;
}

/**
 * Whether what an environment answers is what was deployed to it.
 *
 * The point of the whole feature: "deployed v1.4.2, running 1.4.1" means the
 * deployment did not take, and nothing else on the page says it. Both sides are
 * reduced to the release they state, so a `v` prefix, a `-rc1` suffix and a
 * `+build` metadata do not make two spellings of one release look like two
 * releases.
 */
export function agreesWithRef(version: string | null, ref: string | null): VersionAgreement {
  const running = releaseIn(version);
  const deployed = releaseIn(ref);
  if (!running || !deployed) return 'unknown';
  return running === deployed ? 'match' : 'differs';
}

/**
 * How long ago a reading was taken, in whole minutes, hours or days.
 *
 * Coarse on purpose: a version read four minutes ago and one read six minutes
 * ago are the same fact, and a ticking counter beside every row would suggest a
 * precision the probing interval does not have.
 */
export function readingAge(observedAt: string, now: number = Date.now()): {
  unit: 'minute' | 'hour' | 'day';
  count: number;
} {
  const minutes = Math.max(0, Math.round((now - new Date(observedAt).getTime()) / 60_000));
  if (minutes < 60) return { unit: 'minute', count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { unit: 'hour', count: hours };
  return { unit: 'day', count: Math.round(hours / 24) };
}
