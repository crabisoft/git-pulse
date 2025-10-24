import type { Request } from 'express';
import type { UserPublic } from '@repo/shared';

/**
 * What the guard leaves behind for the handlers. Null once resolved and nobody
 * is signed in, undefined only before the guard has run.
 */
export interface AuthenticatedRequest extends Request {
  user?: UserPublic | null;
}
