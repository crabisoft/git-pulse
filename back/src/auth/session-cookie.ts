import type { Request, Response } from 'express';

export const SESSION_COOKIE = 'gd_session';

/**
 * How long a browser stays signed in without touching anything. Idle rather
 * than absolute: `AuthService.resolve` pushes a session that is still being
 * used past its halfway point, cookie included.
 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Read straight off the header rather than through cookie-parser: one cookie is
 * not worth a dependency, and the parsing is unambiguous.
 */
export function readSessionCookie(req: Request): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('='));
  }
  return null;
}

/**
 * `httpOnly` so a script cannot read the session, `sameSite: lax` so another
 * site cannot ride it. Lax is about the *site*, not the origin: in dev Vite
 * proxies `/api` so there is only one origin anyway, and in prod the front is
 * served by nginx while the API answers on its own port — a different origin,
 * the same site, which is what lax asks for. Hosting the two under separate
 * registrable domains is the case this would not survive.
 *
 * `secure` is left to the deployment: a plain-HTTP install would otherwise
 * silently drop every cookie.
 */
export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

/**
 * Whether the cookie may only travel over HTTPS. Derived from the origin the
 * frontend is served from, so an HTTPS install is protected without anyone
 * having to know this flag exists, and a plain-HTTP one still signs in.
 * `SESSION_COOKIE_SECURE` overrides it for a proxy that terminates TLS
 * elsewhere.
 */
export function isSecureDeployment(): boolean {
  // Empty counts as unset: compose passes an undefined variable through as an
  // empty string, and that must not read as "not secure".
  const override = process.env.SESSION_COOKIE_SECURE;
  if (override) return override === 'true';
  return (process.env.WEB_ORIGIN ?? '').startsWith('https://');
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}
