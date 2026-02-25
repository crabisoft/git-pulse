import type { ClassifiedEnvironment } from '@repo/shared';

export interface EnvRuleLike {
  name: string;
  pattern: string;
  kind: 'simple' | 'meta';
  priority: number;
  /** Attributes forced on a match, for what the name does not spell out. */
  attributes?: Record<string, string>;
  /** Pattern the repo must match; absent means every repo. */
  repo?: string | null;
}

/** Where the name was seen. A repo-scoped rule needs it to contribute. */
export interface ClassifyContext {
  /**
   * The repo the name belongs to, when the caller has one. Undefined is not a
   * wildcard: a view that folds one environment name across several repos has
   * no single repo to answer with, and a rule confined to one must not speak
   * there.
   */
  repo?: string;
}

/**
 * Classifies an environment name against a set of rules.
 * - simple rules contribute named-group attributes and their forced ones,
 *   cumulative across rules; on attribute conflict the lower priority number
 *   wins. Within one rule a group that matched beats the forced value: the
 *   forced one is there for the names that carry nothing to capture.
 * - meta rules add the environment to their meta-environment, cumulative.
 *   Their groups and forced attributes are ignored alike.
 * - a rule naming a repo contributes if and only if the context states a repo
 *   and it matches, whatever the rule's kind.
 * Invalid regex patterns are skipped rather than throwing.
 */
export function classifyEnvironment(
  name: string,
  rules: EnvRuleLike[],
  context: ClassifyContext = {},
): ClassifiedEnvironment {
  const attributes: Record<string, string> = {};
  const winningPriority: Record<string, number> = {};
  const metaEnvironments = new Set<string>();

  for (const rule of rules) {
    if (!appliesToRepo(rule, context.repo)) continue;
    const regex = safeRegExp(rule.pattern);
    if (!regex) continue;
    const match = regex.exec(name);
    if (!match) continue;

    if (rule.kind === 'meta') {
      metaEnvironments.add(rule.name);
      continue;
    }

    // An optional group that did not participate is absent, not empty, so it
    // leaves the forced value in place instead of erasing it.
    const captured = Object.entries(match.groups ?? {}).filter(([, v]) => v !== undefined);
    for (const [key, value] of Object.entries({
      ...rule.attributes,
      ...Object.fromEntries(captured),
    })) {
      if (!(key in winningPriority) || rule.priority < winningPriority[key]) {
        attributes[key] = value;
        winningPriority[key] = rule.priority;
      }
    }
  }

  return { name, attributes, metaEnvironments: [...metaEnvironments].sort() };
}

/**
 * A rule bound to no repo applies everywhere. One that names a repo needs the
 * caller to know which repo it is looking at, and an unreadable pattern keeps
 * the rule silent rather than letting it apply to everything.
 */
function appliesToRepo(rule: EnvRuleLike, repo: string | undefined): boolean {
  if (!rule.repo) return true;
  if (repo === undefined) return false;
  return safeRegExp(rule.repo)?.test(repo) ?? false;
}

function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
