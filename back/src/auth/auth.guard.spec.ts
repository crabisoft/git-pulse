import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { UserPublic } from '@repo/shared';
import { AuthGuard } from './auth.guard';
import { Anonymous, Viewer } from './access.decorator';
import type { AuthService } from './auth.service';
import type { SettingsService } from '../settings/settings.service';
import type { AuthenticatedRequest } from './authenticated-request';

const ADMIN = { id: 'u1', role: 'admin' } as UserPublic;
const USER = { id: 'u2', role: 'user' } as UserPublic;

/** Controllers as the decorators actually see them, rather than a metadata mock. */
class OpenController {
  @Anonymous()
  open() {}
}

@Viewer()
class ReadController {
  read() {}
}

class DefaultController {
  anything() {}
}

function guardFor(user: UserPublic | null, publicDashboard: boolean, refreshed = false) {
  const auth = { resolve: async () => ({ user, refreshed }) } as unknown as AuthService;
  const settings = { get: async () => ({ publicDashboard }) } as unknown as SettingsService;
  return new AuthGuard(new Reflector(), auth, settings);
}

/** Minimal execution context: a handler, its class, a request and a response. */
function contextFor(cls: new () => object, method: string, cookie = '') {
  const req = { headers: cookie ? { cookie } : {} } as AuthenticatedRequest;
  const res = { cookies: [] as unknown[], cookie: (...args: unknown[]) => res.cookies.push(args) };
  const context = {
    getHandler: () => (cls.prototype as Record<string, unknown>)[method],
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { context, req, res };
}

describe('AuthGuard', () => {
  it('closes an undecorated route to everyone but an admin', async () => {
    const { context } = contextFor(DefaultController, 'anything');
    await expect(guardFor(ADMIN, false).canActivate(context)).resolves.toBe(true);
    await expect(guardFor(USER, true).canActivate(context)).rejects.toThrow();
    await expect(guardFor(null, true).canActivate(context)).rejects.toThrow();
  });

  it('follows the public setting on a route the controller marks as viewer', async () => {
    const { context } = contextFor(ReadController, 'read');
    await expect(guardFor(null, true).canActivate(context)).resolves.toBe(true);
    await expect(guardFor(null, false).canActivate(context)).rejects.toThrow();
    await expect(guardFor(USER, false).canActivate(context)).resolves.toBe(true);
  });

  it('lets an anonymous route through without reading the settings', async () => {
    const { context } = contextFor(OpenController, 'open');
    const guard = new AuthGuard(
      new Reflector(),
      { resolve: async () => ({ user: null, refreshed: false }) } as unknown as AuthService,
      {
        get: () => {
          throw new Error('settings must not be read on an anonymous route');
        },
      } as unknown as SettingsService,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('leaves the resolved account on the request, including for the handlers that admit none', async () => {
    const open = contextFor(OpenController, 'open');
    await guardFor(ADMIN, false).canActivate(open.context);
    expect(open.req.user).toBe(ADMIN);

    const anonymous = contextFor(ReadController, 'read');
    await guardFor(null, true).canActivate(anonymous.context);
    expect(anonymous.req.user).toBeNull();
  });

  it('re-sends the cookie when the session it carried was pushed back', async () => {
    const { context, res } = contextFor(ReadController, 'read', 'gd_session=abc');
    await guardFor(USER, false, true).canActivate(context);
    expect(res.cookies).toHaveLength(1);
    // Same name, same token — the options are the cookie helper's business.
    expect((res.cookies[0] as unknown[]).slice(0, 2)).toEqual(['gd_session', 'abc']);
  });

  it('leaves the cookie alone when nothing was pushed back, or there was none', async () => {
    const untouched = contextFor(ReadController, 'read', 'gd_session=abc');
    await guardFor(USER, false, false).canActivate(untouched.context);
    expect(untouched.res.cookies).toHaveLength(0);

    // A refresh cannot happen without a cookie, but nothing may be sent if it does.
    const cookieless = contextFor(ReadController, 'read');
    await guardFor(USER, false, true).canActivate(cookieless.context);
    expect(cookieless.res.cookies).toHaveLength(0);
  });

  it('asks an anonymous caller to sign in, and tells a signed-in one not to bother', async () => {
    const { context } = contextFor(DefaultController, 'anything');
    await expect(guardFor(null, false).canActivate(context)).rejects.toMatchObject({ status: 401 });
    await expect(guardFor(USER, false).canActivate(context)).rejects.toMatchObject({ status: 403 });
  });
});
