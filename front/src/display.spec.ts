import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apply, effective, MODE_KEY, resolveMode, watchSystem } from './display';

/** jsdom ships no `matchMedia`; every case here turns on what it answers. */
function stubSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', () => media);
  window.matchMedia = (() => media) as never;
  return { media, listeners };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-mode');
  document.documentElement.removeAttribute('data-direction');
});

afterEach(() => vi.unstubAllGlobals());

describe('resolveMode', () => {
  it('hands `system` back to the operating system', () => {
    stubSystem(true);
    expect(resolveMode('system')).toBe('dark');
  });

  it('does not let the machine revise an explicit choice', () => {
    stubSystem(true);
    expect(resolveMode('light')).toBe('light');
  });
});

describe('effective', () => {
  const settings = { overviewDirection: 'instrument' as const, displayMode: 'dark' as const };

  it('follows the installation when the account chose nothing', () => {
    expect(effective(settings, { direction: null, mode: null })).toEqual({
      direction: 'instrument',
      mode: 'dark',
    });
  });

  it('lets an account override one axis without the other', () => {
    expect(effective(settings, { direction: null, mode: 'light' })).toEqual({
      direction: 'instrument',
      mode: 'light',
    });
  });

  it('falls back to the control room before anything has loaded', () => {
    expect(effective(null, null)).toEqual({ direction: 'control', mode: 'system' });
  });
});

describe('apply', () => {
  it('stamps the resolved mode, never `system` itself', () => {
    // The stylesheet keys on light/dark; a third value would match no rule.
    stubSystem(true);
    apply({ direction: 'control', mode: 'system' });
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(document.documentElement.dataset.direction).toBe('control');
  });

  it('leaves the choice behind for the next load', () => {
    // What the inline script in index.html reads before React mounts.
    stubSystem(false);
    apply({ direction: 'stream', mode: 'dark' });
    expect(localStorage.getItem(MODE_KEY)).toBe('dark');
  });

  it('survives a browser that refuses storage', () => {
    stubSystem(false);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => apply({ direction: 'control', mode: 'light' })).not.toThrow();
    expect(document.documentElement.dataset.mode).toBe('light');
    setItem.mockRestore();
  });
});

describe('watchSystem', () => {
  it('follows the machine while `system` is what was chosen', () => {
    // The desk switches itself at sunset, and the tab is open at the time.
    const { listeners } = stubSystem(false);
    const onChange = vi.fn();
    const stop = watchSystem('system', onChange);

    expect(listeners.size).toBe(1);
    listeners.forEach((fn) => fn());
    expect(onChange).toHaveBeenCalledOnce();

    stop();
    expect(listeners.size).toBe(0);
  });

  it('subscribes to nothing once a mode was picked by hand', () => {
    const { listeners } = stubSystem(false);
    watchSystem('dark', vi.fn());
    expect(listeners.size).toBe(0);
  });
});
