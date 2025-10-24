import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CodedException } from '../common/coded-exception';
import { SettingsService } from '../settings/settings.service';
import { grants, type AccessLevel } from './access';
import { ACCESS_LEVEL } from './access.decorator';
import { AuthService } from './auth.service';
import { readSessionCookie } from './session-cookie';
import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Registered globally, so a route is protected by existing rather than by
 * remembering to guard it. `admin` is the default: a new endpoint is closed
 * until someone decides otherwise, and the decision shows up in the diff.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<AccessLevel>(ACCESS_LEVEL, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'admin';

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Resolved even on an anonymous route: `/auth/me` answers with it, and a
    // handler that admits both callers still wants to know which one it got.
    const user = await this.auth.resolve(readSessionCookie(req));
    req.user = user;
    if (required === 'anonymous') return true;

    const { publicDashboard } = await this.settings.get();
    if (grants(required, { role: user?.role ?? null, publicDashboard })) return true;

    // 401 invites the client to sign in; 403 tells it not to bother.
    throw user
      ? new CodedException('errors.auth.forbidden', HttpStatus.FORBIDDEN)
      : new CodedException('errors.auth.required', HttpStatus.UNAUTHORIZED);
  }
}
