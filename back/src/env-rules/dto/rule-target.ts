import type { RuleTarget } from '@repo/shared';

/**
 * The values `@IsEnum` accepts for a rule target. Declared once: spelled out in
 * each DTO, the list silently fell behind when `incident` was added to
 * RuleTarget, and every request carrying it was rejected with a 400.
 */
export const RULE_TARGETS = ['environment', 'repository', 'incident'] as const satisfies readonly RuleTarget[];
