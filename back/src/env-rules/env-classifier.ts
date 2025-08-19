import type { ClassifiedEnvironment } from '@repo/shared';

export interface EnvRuleLike {
  name: string;
  pattern: string;
  kind: 'simple' | 'meta';
  priority: number;
}

/**
 * Classifies an environment name against a set of rules.
 * - simple rules contribute named-group attributes, cumulative across rules;
 *   on attribute conflict the lower priority number wins.
 * - meta rules add the environment to their meta-environment, cumulative.
 * Invalid regex patterns are skipped rather than throwing.
 */
export function classifyEnvironment(name: string, rules: EnvRuleLike[]): ClassifiedEnvironment {
  const attributes: Record<string, string> = {};
  const winningPriority: Record<string, number> = {};
  const metaEnvironments = new Set<string>();

  for (const rule of rules) {
    const regex = safeRegExp(rule.pattern);
    if (!regex) continue;
    const match = regex.exec(name);
    if (!match) continue;

    if (rule.kind === 'meta') {
      metaEnvironments.add(rule.name);
      continue;
    }

    for (const [key, value] of Object.entries(match.groups ?? {})) {
      if (value === undefined) continue;
      if (!(key in winningPriority) || rule.priority < winningPriority[key]) {
        attributes[key] = value;
        winningPriority[key] = rule.priority;
      }
    }
  }

  return { name, attributes, metaEnvironments: [...metaEnvironments].sort() };
}

function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
