import type { EnvUrlMode } from '@repo/shared';

/** A rule, reduced to what selecting and addressing need. */
export interface EnvUrlRuleLike {
  name: string;
  /** Pattern the environment name must match; its named groups feed the template. */
  pattern: string;
  /** Pattern the repo must match. Null means every repo. */
  repo?: string | null;
  urlTemplate: string;
  mode: EnvUrlMode;
  /** Lower wins when two rules claim the same environment. */
  priority: number;
}

/** A declared environment, reduced to what answering with it needs. */
export interface ManualEnvironmentLike {
  /** Empty when the environment belongs to no repo. */
  repo: string;
  environment: string;
  url?: string | null;
  mode: EnvUrlMode;
}

/**
 * The environment an address is wanted for.
 *
 * `environmentUrl` is what the platform published, and is null far more often
 * than not — GitHub carries it on a deployment status, GitLab only when an
 * environment was configured with an external URL. That absence is the ordinary
 * case this module answers, not an edge of it.
 */
export interface AddressSubject {
  /** Empty when the environment belongs to no repo — a declared one may not. */
  repo: string;
  environment: string;
  /** The deployed ref, when the caller has one. */
  ref?: string | null;
  environmentUrl?: string | null;
  /** Attributes from the classification rules, addressable as `{attr.key}`. */
  attributes?: Record<string, string>;
}

/**
 * Where this environment answers, all things considered — the platform's own
 * address, or ours when we have one and are allowed to use it.
 *
 * Returns the subject's address unchanged when nothing applies, so the caller
 * can assign the result without asking whether anything happened.
 *
 * Order of authority: a declaration by hand, then the rules, then the platform.
 * A declaration is somebody stating outright where a named environment lives,
 * which no pattern can be more specific than; the platform comes last among the
 * three that claim to know, but only ever loses to a claim made deliberately —
 * `fill`, the default on both, stands down as soon as the platform published
 * anything at all.
 */
export function environmentUrlFor(
  subject: AddressSubject,
  rules: EnvUrlRuleLike[],
  declared: ManualEnvironmentLike[] = [],
): string | null {
  return resolveEnvUrl(subject, rules, declared).url;
}

/**
 * The same answer, with what produced it — for whoever is *writing* a rule.
 *
 * The address alone cannot be argued with. A null one has two causes that look
 * identical on a page and are nothing alike to fix: no rule claimed the
 * environment, or one claimed it and its template named something that does not
 * resolve. The second is the ordinary mistake — a pattern capturing
 * `(?<Customer>…)` against a template asking for `{customer}` — and reporting
 * it as "no rule addresses this environment" sends the author back to a pattern
 * that was never wrong.
 *
 * Everything the answer is made of is already known here; it was simply thrown
 * away on the way out. `environmentUrlFor` keeps throwing it away, since the
 * board and the deployment list want an address and nothing else.
 */
export function resolveEnvUrl(
  subject: AddressSubject,
  rules: EnvUrlRuleLike[],
  declared: ManualEnvironmentLike[] = [],
): EnvUrlResolution {
  const published = subject.environmentUrl || null;

  const manual = declarationFor(subject, declared);
  if (manual?.url && allowed(manual.mode, published)) {
    return { url: manual.url, rule: null, declared: true, unresolved: null };
  }

  const rule = ruleFor(subject, rules);
  if (!rule) return { url: published, rule: null, declared: false, unresolved: null };
  // It claimed the environment and stood down: `fill` against a platform that
  // published something. Named all the same — that the rule matched is the
  // thing an author cannot otherwise tell.
  if (!allowed(rule.mode, published)) {
    return { url: published, rule: rule.name, declared: false, unresolved: null };
  }

  // The match is redone rather than carried out of `ruleFor`: only the selected
  // rule's groups are ever addressed, and matching one pattern twice is cheaper
  // than keeping every candidate's match alive to throw all but one away.
  const groups = safeRegExp(rule.pattern)?.exec(subject.environment)?.groups ?? {};
  const rendered = render(rule.urlTemplate, subject, groups);
  return rendered.ok
    ? { url: rendered.url, rule: rule.name, declared: false, unresolved: null }
    : { url: published, rule: rule.name, declared: false, unresolved: rendered.unresolved };
}

/** Where an environment answers, and what decided it. */
export interface EnvUrlResolution {
  url: string | null;
  /** The rule that answered, or that claimed the environment and could not. */
  rule: string | null;
  /** Whether a declaration by hand answered, which outranks every rule. */
  declared: boolean;
  /** The placeholder that kept the rule silent, when one did. */
  unresolved: string | null;
}

/**
 * The declaration answering for this environment, or undefined.
 *
 * The pair matches first, then a declaration bound to no repo — that one is the
 * customer instance nothing deploys to through the platform, and it answers for
 * the name wherever the name turns up. A repo-bound declaration never answers
 * for another repo, which is the whole reason to bind one.
 */
export function declarationFor(
  subject: AddressSubject,
  declared: ManualEnvironmentLike[],
): ManualEnvironmentLike | undefined {
  const named = declared.filter((entry) => entry.environment === subject.environment);
  return (
    named.find((entry) => entry.repo === subject.repo) ?? named.find((entry) => entry.repo === '')
  );
}

/**
 * The rule that answers for an environment, or null when none does.
 *
 * Lowest priority number first, declaration order breaking a tie — the ordering
 * every rule engine here uses. Like the version rules and unlike the
 * classification ones this *selects*: an environment has one address, so rules
 * cannot each contribute a piece of it and the most specific has to win
 * outright.
 *
 * An unreadable pattern keeps its rule silent rather than letting it apply
 * everywhere: a rule nobody can read is a rule nobody meant to point at every
 * environment.
 */
export function ruleFor<T extends EnvUrlRuleLike>(
  subject: AddressSubject,
  rules: T[],
): T | null {
  const applicable = rules.filter(
    (rule) => matches(rule.pattern, subject.environment) && appliesToRepo(rule, subject.repo),
  );
  if (applicable.length === 0) return null;
  return applicable.reduce((best, rule) => (rule.priority < best.priority ? rule : best));
}

/**
 * A rule bound to no repo applies everywhere. One that names a repo needs a repo
 * to look at, and an environment belonging to none is not a wildcard: a rule
 * confined to `portal-api` has nothing to say about an appliance running at a
 * customer's site, and letting the empty repo match its pattern would have it
 * answer for exactly the environments it was confined away from.
 */
function appliesToRepo(rule: EnvUrlRuleLike, repo: string): boolean {
  if (!rule.repo) return true;
  if (repo === '') return false;
  return matches(rule.repo, repo);
}

/** `fill` stands down as soon as the platform published something. */
function allowed(mode: EnvUrlMode, published: string | null): boolean {
  return mode === 'overwrite' || published === null;
}

/**
 * The template with its placeholders resolved, or the first one that could not
 * be.
 *
 * A name rather than a URL with a hole in it: an address is either somewhere to
 * go or nothing at all, and `https://{client}.example.com` sent to a browser
 * fails in a way nobody can read back to the rule that produced it. The caller
 * keeps whatever the platform said instead — but it is told which placeholder
 * cost it the address, because that is the whole of what the author has to fix.
 *
 * The first unresolved one is the one named. A template naming three is fixed by
 * looking at one at a time, exactly as in `probeUrl`.
 *
 * The pattern's own groups outrank the fixed names. A rule that captures
 * `(?<environment>…)` means that group: it wrote it, and the raw name is what it
 * chose to narrow. Group names are matched as spelled — `(?<Customer>…)` is not
 * `{customer}`, JavaScript being case-sensitive about both.
 *
 * Values are interpolated raw. Encoding them would break the repo paths that
 * carry a slash by design, and the boundary is not here anyway — the address is
 * validated where it is used, by the probe that resolves it before connecting
 * and by the front that refuses to render a scheme it does not know.
 */
function render(
  template: string,
  subject: AddressSubject,
  groups: Record<string, string | undefined>,
): { ok: true; url: string } | { ok: false; unresolved: string } {
  const fixed: Record<string, string | undefined> = {
    environment: subject.environment,
    repo: subject.repo || undefined,
    ref: subject.ref || undefined,
  };

  let unresolved: string | null = null;
  const url = template.replace(/\{([\w.@-]+)\}/g, (whole, name: string) => {
    const value = name.startsWith('attr.')
      ? subject.attributes?.[name.slice('attr.'.length)]
      : (groups[name] ?? fixed[name]);
    if (value !== undefined) return value;
    unresolved ??= name;
    return whole;
  });

  return unresolved === null ? { ok: true, url } : { ok: false, unresolved };
}

function matches(pattern: string, value: string): boolean {
  return safeRegExp(pattern)?.test(value) ?? false;
}

function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
