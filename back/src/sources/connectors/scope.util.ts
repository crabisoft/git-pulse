import type { ScopeRules } from '@repo/shared';

/** Apply include/exclude rules to a list of discovered repos. */
export function applyScope(repos: string[], scope: ScopeRules): string[] {
  const include = scope.include ?? [];
  const exclude = new Set(scope.exclude ?? []);
  const base = include.length > 0 ? repos.filter((r) => include.includes(r)) : repos;
  return base.filter((r) => !exclude.has(r));
}

/** Hours elapsed between an ISO date and now. */
export function ageHours(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round((ms / 36e5) * 10) / 10);
}
