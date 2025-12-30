import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ACCESS_LEVEL } from './access.decorator';
import type { AccessLevel } from './access';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { SettingsController } from '../settings/settings.controller';
import { JobsController } from '../jobs/jobs.controller';

/**
 * The level a route ends up with, decorators and default included — read off
 * the real controllers. Access is the kind of thing that changes by accident
 * when a handler is moved or a decorator lands one line too high, and nothing
 * about the code would look wrong afterwards.
 */
function levelOf(cls: new (...args: never[]) => object, method: string): AccessLevel {
  const handler = (cls.prototype as Record<string, () => unknown>)[method];
  const level = new Reflector().getAllAndOverride(ACCESS_LEVEL, [handler, cls]) as
    | AccessLevel
    | undefined;
  return level ?? 'admin';
}

describe('route access', () => {
  it('opens exactly what has to answer without a session', () => {
    expect(levelOf(AuthController, 'me')).toBe('anonymous');
    expect(levelOf(AuthController, 'login')).toBe('anonymous');
    expect(levelOf(AuthController, 'logout')).toBe('anonymous');
    expect(levelOf(AuthController, 'setup')).toBe('anonymous');
    // A reset link is used by someone who by definition cannot sign in.
    expect(levelOf(AuthController, 'resetTarget')).toBe('anonymous');
    expect(levelOf(AuthController, 'reset')).toBe('anonymous');
  });

  it('asks for an account where the answer is about the caller', () => {
    expect(levelOf(AuthController, 'updateMe')).toBe('account');
  });

  it('keeps every account route with the admins, reset links included', () => {
    for (const method of ['findAll', 'create', 'update', 'remove', 'issueResetLink']) {
      expect(levelOf(UsersController, method), method).toBe('admin');
    }
  });

  it('lets the settings be read wherever the dashboard is, and written by admins only', () => {
    expect(levelOf(SettingsController, 'get')).toBe('viewer');
    expect(levelOf(SettingsController, 'update')).toBe('admin');
  });

  it('keeps the queues with the admins, reading them included', () => {
    // A failure carries the payload it was working on and what a platform
    // answered — more than the dashboard shows a viewer anywhere else.
    for (const method of ['snapshot', 'failures', 'degraded', 'retry', 'discard']) {
      expect(levelOf(JobsController, method), method).toBe('admin');
    }
  });
});
