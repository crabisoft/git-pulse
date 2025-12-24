import { scopeTracks, type ScopeRules } from '@repo/shared';

/** Keeps the discovered repos the scope covers, in the order they came in. */
export function applyScope(repos: string[], scope: ScopeRules): string[] {
  return repos.filter((repo) => scopeTracks(scope, repo));
}

/** Hours elapsed between an ISO date and now. */
export function ageHours(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round((ms / 36e5) * 10) / 10);
}
