import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserPublic } from '@repo/shared';
import type { AccessLevel } from './access';
import type { AuthenticatedRequest } from './authenticated-request';

export const ACCESS_LEVEL = 'access:level';

/**
 * Open to anyone: signing in, signing out, and reading the session state — the
 * routes that must answer before there is a session to speak of.
 */
export const Anonymous = () => SetMetadata(ACCESS_LEVEL, 'anonymous' satisfies AccessLevel);

/**
 * Readable by any signed-in account, and by anonymous visitors while the
 * dashboard is public. This is what the public setting actually switches.
 */
export const Viewer = () => SetMetadata(ACCESS_LEVEL, 'viewer' satisfies AccessLevel);

/**
 * Any signed-in account, and only a signed-in one — what belongs to somebody
 * stays out of reach of a visitor however public the dashboard is.
 */
export const Account = () => SetMetadata(ACCESS_LEVEL, 'account' satisfies AccessLevel);

/** The signed-in account, or null on the routes that admit anonymous callers. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserPublic | null =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user ?? null,
);
