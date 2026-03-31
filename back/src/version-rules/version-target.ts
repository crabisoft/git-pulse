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
 * The rule that answers for an environment, or null when none does.
 *
 * Lowest priority number first, declaration order breaking a tie — the same
 * ordering the classification and ticket rules use, so an install that has
 * learnt one has learnt all three. Unlike those two this one *selects*: a
 * version is a single reading, so several rules matching cannot each contribute
 * a piece of it, and the most specific rule has to be able to win outright.
 *
 * An unreadable pattern keeps its rule silent rather than letting it apply
 * everywhere, exactly as in `classifyEnvironment`: a rule nobody can read is a
 * rule nobody meant to point at every environment.
 */
export function ruleFor<T extends VersionRuleLike>(subject: ProbeSubject, rules: T[]): T | null {
  const applicable = rules.filter(
    (rule) => matches(rule.environment, subject.environment) && matches(rule.repo, subject.repo),
  );
  if (applicable.length === 0) return null;
  return applicable.reduce((best, rule) => (rule.priority < best.priority ? rule : best));
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
