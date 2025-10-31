import { describe, expect, it } from 'vitest';
import { LoginThrottle, WINDOW_MS } from './login-throttle';

const KEYS = { email: 'a@b.c', ip: '10.0.0.1' };
const NOW = 1_700_000_000_000;

/** Fails `times` attempts from the same caller, one second apart. */
function fail(throttle: LoginThrottle, keys = KEYS, times = 1, from = NOW): number {
  let now = from;
  for (let i = 0; i < times; i++) throttle.recordFailure(keys, (now = from + i * 1000));
  return now;
}

describe('LoginThrottle', () => {
  it('lets a handful of failures through', () => {
    const throttle = new LoginThrottle();
    const now = fail(throttle, KEYS, 9);
    expect(throttle.retryAfter(KEYS, now)).toBe(0);
  });

  it('closes the address once its limit is reached, and says for how long', () => {
    const throttle = new LoginThrottle();
    const now = fail(throttle, KEYS, 10);
    expect(throttle.retryAfter(KEYS, now)).toBeGreaterThan(0);
    expect(throttle.retryAfter(KEYS, now)).toBeLessThanOrEqual(WINDOW_MS);
  });

  it('forgets the failures once the window has passed', () => {
    const throttle = new LoginThrottle();
    const now = fail(throttle, KEYS, 10);
    expect(throttle.retryAfter(KEYS, now + WINDOW_MS + 1)).toBe(0);
  });

  it('reopens on a successful sign-in', () => {
    const throttle = new LoginThrottle();
    const now = fail(throttle, KEYS, 10);
    throttle.clear(KEYS);
    expect(throttle.retryAfter(KEYS, now)).toBe(0);
  });

  it('counts an address separately from the callers trying it', () => {
    const throttle = new LoginThrottle();
    // The same address hammered from ten hosts: the address bucket closes,
    // while a host that only tried once is not held responsible for it.
    let now = NOW;
    for (let host = 0; host < 10; host++) {
      now = fail(throttle, { email: KEYS.email, ip: `10.0.0.${host}` }, 1, NOW + host * 1000);
    }
    expect(throttle.retryAfter(KEYS, now)).toBeGreaterThan(0);
    expect(throttle.retryAfter({ email: 'other@b.c', ip: '10.0.0.1' }, now)).toBe(0);
  });

  it('closes a caller spraying many addresses, before any single one is locked', () => {
    const throttle = new LoginThrottle();
    let now = NOW;
    for (let account = 0; account < 30; account++) {
      now = fail(throttle, { email: `u${account}@b.c`, ip: KEYS.ip }, 1, NOW + account * 1000);
    }
    // The IP is out, and it is the IP that stopped it: no address reached 10.
    expect(throttle.retryAfter({ email: 'fresh@b.c', ip: KEYS.ip }, now)).toBeGreaterThan(0);
    expect(throttle.retryAfter({ email: 'u0@b.c', ip: '10.0.0.2' }, now)).toBe(0);
  });
});
