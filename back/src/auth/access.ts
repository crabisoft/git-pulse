import type { UserRole } from '@repo/shared';

/**
 * What a route asks of its caller. `admin` is the default of every route that
 * says nothing, so forgetting to mark one locks it down instead of opening it.
 */
export type AccessLevel = 'anonymous' | 'viewer' | 'admin';

/** Who is calling, and what the install lets an anonymous visitor read. */
export interface AccessContext {
  role: UserRole | null;
  publicDashboard: boolean;
}

/**
 * The whole access model, kept as one pure function so it can be read — and
 * tested — without a request in sight.
 *
 * `viewer` is the only level that depends on the install: it is what the public
 * setting opens or closes. An admin passes everywhere by construction, since
 * every route a user may call is one an admin may call too.
 */
export function grants(required: AccessLevel, { role, publicDashboard }: AccessContext): boolean {
  if (required === 'anonymous') return true;
  if (role === 'admin') return true;
  if (required === 'admin') return false;
  return role !== null || publicDashboard;
}
