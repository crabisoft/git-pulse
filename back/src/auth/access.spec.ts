import { describe, expect, it } from 'vitest';
import { grants } from './access';

describe('grants', () => {
  const anonymous = { role: null, publicDashboard: false };
  const visitor = { role: null, publicDashboard: true };
  const user = { role: 'user' as const, publicDashboard: false };
  const admin = { role: 'admin' as const, publicDashboard: false };

  it('lets anyone reach an anonymous route', () => {
    expect(grants('anonymous', anonymous)).toBe(true);
    expect(grants('anonymous', admin)).toBe(true);
  });

  it('opens the viewer routes to everyone only while the dashboard is public', () => {
    expect(grants('viewer', visitor)).toBe(true);
    expect(grants('viewer', anonymous)).toBe(false);
  });

  it('keeps the viewer routes open to a signed-in user whatever the setting', () => {
    expect(grants('viewer', user)).toBe(true);
  });

  it('asks the account routes for an account, whatever the dashboard is open to', () => {
    expect(grants('account', user)).toBe(true);
    expect(grants('account', admin)).toBe(true);
    expect(grants('account', visitor)).toBe(false);
    expect(grants('account', anonymous)).toBe(false);
  });

  it('reserves the admin routes, public dashboard or not', () => {
    expect(grants('admin', user)).toBe(false);
    expect(grants('admin', { role: 'user', publicDashboard: true })).toBe(false);
    expect(grants('admin', anonymous)).toBe(false);
    expect(grants('admin', admin)).toBe(true);
  });
});
