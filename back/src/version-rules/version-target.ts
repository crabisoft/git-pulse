import type { CodedMessage } from '@repo/shared';

/** A rule, reduced to what deciding and addressing need. */
export interface VersionRuleLike {
  id: string;
  name: string;
  /** Pattern the environment name must match. Null means every environment. */
  environment?: string | null;
  /** Pattern the repo must match. Null means every repo. */
  repo?: string | null;
  urlTemplate: string;
  /** Lower wins when two rules claim the same environment. */
  priority: number;
}

/**
 * The environment a probe is about, as the deployment that reached it describes
 * it.
 *
 * `environmentUrl` is the platform's own reading and is null far more often
 * than not — GitHub carries it on a deployment status, GitLab only when an
 * environment was configured with an external URL. A rule addressing it has to
 * survive that, which is why an unresolvable placeholder is an outcome here and
 * not an error.
 */
export interface ProbeSubject {
  repo: string;
  environment: string;
  /** The deployed ref, when the caller has one. */
  ref?: string | null;
  environmentUrl?: string | null;
  /** Attributes from the classification rules, addressable as `{attr.key}`. */
  attributes?: Record<string, string>;
}

export type ProbeTarget = { ok: true; url: string } | { ok: false; reason: CodedMessage };

/**
 * Every rule that answers for an environment, the one to try first at the head.
 *
 * Lowest priority number first, declaration order breaking a tie — the same
 * ordering the classification and ticket rules use, so an install that has
 * learnt one has learnt all three. Unlike those two this one *ranks* rather than
 * accumulates: a version is a single reading, so several rules cannot each
 * contribute a piece of it. They are candidates in turn, not contributors.
 *
 * The whole list rather than its head because one application may state its
 * version at more than one address — an actuator on the ones deployed this
 * year, a static `version.json` on the ones that are not — and which of them
 * answers is a property of the environment nobody can be asked to enumerate in
 * a pattern. `readOne` walks it until one address answers; see there for what
 * counts as an answer.
 *
 * An unreadable pattern keeps its rule silent rather than letting it apply
 * everywhere, exactly as in `classifyEnvironment`: a rule nobody can read is a
 * rule nobody meant to point at every environment.
 */
export function rulesFor<T extends VersionRuleLike>(subject: ProbeSubject, rules: T[]): T[] {
  return rules
    .filter(
      (rule) => matches(rule.environment, subject.environment) && appliesToRepo(rule, subject.repo),
    )
    .sort((a, b) => a.priority - b.priority);
}

/**
 * The same rules, with the one that last answered moved to the front.
 *
 * The order above is what an author *declared*; this is what an environment has
 * actually been observed to do, and it outranks the declaration because it is
 * evidence. Without it an environment whose third rule answers pays the first
 * two — two addresses that do not exist, each held to its timeout — on every
 * cycle, for ever. With it, that is paid once and then only when the address
 * that was working stops.
 *
 * A rule since deleted, or one no longer applying to this environment, is not
 * found and changes nothing: the declared order stands, which is the same thing
 * that happens the first time an environment is read.
 */
export function preferring<T extends { id: string }>(
  rules: T[],
  lastAnswered: string | null | undefined,
): T[] {
  if (!lastAnswered) return rules;
  const held = rules.find((rule) => rule.id === lastAnswered);
  if (!held) return rules;
  return [held, ...rules.filter((rule) => rule !== held)];
}

/**
 * A rule bound to no repo applies everywhere. One that names a repo needs a repo
 * to look at, and an environment belonging to none — a declared one, an
 * appliance nothing deploys to through the platform — is not a wildcard: a rule
 * confined to `portal-api` has nothing to say about it, and testing its pattern
 * against the empty string would have `.*` claim exactly what it was confined
 * away from.
 */
function appliesToRepo(rule: VersionRuleLike, repo: string): boolean {
  if (!rule.repo) return true;
  if (repo === '') return false;
  return matches(rule.repo, repo);
}

function matches(pattern: string | null | undefined, value: string): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

/**
 * Where a rule says this environment answers, or why it cannot say.
 *
 * Two shapes are covered by the same template, and both are common: an address
 * derived from what the platform published — `{environmentUrl}/actuator/info` —
 * and one spelled out against the classification, `https://{attr.client}.example.com/version`.
 * The second exists because the first is unavailable most of the time.
 *
 * A placeholder that cannot be resolved yields a reason rather than a URL with
 * a hole in it, and the caller treats it as "this rule has nothing to say about
 * this deployment". That is the normal course of events, not a failure: a rule
 * addressing `{environmentUrl}` is silent on every environment whose platform
 * publishes none, and saying so once per environment is worth more than a
 * connection attempt against `undefined/actuator/info`.
 *
 * Values are interpolated raw. Encoding them would break the repo paths that
 * carry a slash by design, and the security boundary is not here anyway: the
 * probe validates the URL it is handed — scheme, then resolved address — which
 * is the only check that holds whatever the template and the values conspire to
 * produce.
 */
export function probeUrl(rule: VersionRuleLike, subject: ProbeSubject): ProbeTarget {
  // A trailing slash on the platform's URL would otherwise double up with the
  // one a template writes before its path, and some servers do not forgive it.
  const values: Record<string, string | undefined> = {
    environmentUrl: subject.environmentUrl?.replace(/\/+$/, '') || undefined,
    repo: subject.repo,
    environment: subject.environment,
    ref: subject.ref || undefined,
  };

  let missing: CodedMessage | null = null;
  const url = rule.urlTemplate.replace(/\{([\w.@-]+)\}/g, (whole, name: string) => {
    const value = name.startsWith('attr.')
      ? subject.attributes?.[name.slice('attr.'.length)]
      : values[name];
    if (value !== undefined) return value;

    // The first unresolved placeholder is the one reported: a template naming
    // three is fixed by looking at one at a time, and the environment URL being
    // absent explains the other two often enough.
    missing ??= reasonFor(name);
    return whole;
  });

  return missing ? { ok: false, reason: missing } : { ok: true, url };
}

/**
 * Told apart because the answers differ. An absent environment URL is a fact
 * about the platform and is fixed by addressing the environment another way; an
 * absent attribute is a classification rule that did not fire; an unknown name
 * is a typo in the rule being written.
 */
function reasonFor(name: string): CodedMessage {
  if (name === 'environmentUrl') return { code: 'errors.version.noEnvironmentUrl' };
  if (name.startsWith('attr.')) {
    return { code: 'errors.version.noAttribute', params: { key: name.slice('attr.'.length) } };
  }
  if (name === 'ref') return { code: 'errors.version.noRef' };
  return { code: 'errors.version.unknownPlaceholder', params: { name } };
}
