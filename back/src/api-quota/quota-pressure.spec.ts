import { describe, expect, it } from 'vitest';
import { allowsOptionalWork, countCall, remainingShare, type Reading } from './quota-pressure';
import type { QuotaSample } from './rate-limit-headers';

const BUDGET = { bucket: 'rest', limit: 600, windowSec: 60 };
const NOW = new Date('2026-07-27T12:00:00Z');

function reading(over: Partial<QuotaSample>, origin: Reading['origin'] = 'observed'): Reading {
  return {
    origin,
    sample: {
      bucket: 'core',
      limit: 5000,
      used: 0,
      resetAt: new Date(NOW.getTime() + 600_000),
      windowSec: 3600,
      ...over,
    },
  };
}

describe('countCall', () => {
  it('opens a window on the first call charged', () => {
    expect(countCall(undefined, BUDGET, NOW)).toEqual({
      bucket: 'rest',
      limit: 600,
      used: 1,
      resetAt: new Date('2026-07-27T12:01:00Z'),
      windowSec: 60,
    });
  });

  it('adds to the count while the window runs', () => {
    const held = countCall(undefined, BUDGET, NOW);
    const next = countCall(held, BUDGET, new Date(NOW.getTime() + 30_000));

    expect(next.used).toBe(2);
    // Still the window the first call opened — a call does not extend it.
    expect(next.resetAt).toEqual(held.resetAt);
  });

  it('starts again once the window has elapsed', () => {
    const held = countCall(undefined, BUDGET, NOW);
    const later = new Date(NOW.getTime() + 90_000);

    expect(countCall(held, BUDGET, later)).toEqual(
      expect.objectContaining({ used: 1, resetAt: new Date(later.getTime() + 60_000) }),
    );
  });

  it('follows a ceiling that was raised, without waiting for the window', () => {
    const held = countCall(undefined, BUDGET, NOW);

    expect(countCall(held, { ...BUDGET, limit: 2000 }, NOW).limit).toBe(2000);
  });
});

describe('remainingShare', () => {
  it('is decided by the scarcest bucket', () => {
    const share = remainingShare(
      [
        reading({ bucket: 'core', limit: 5000, used: 500 }),
        reading({ bucket: 'search', limit: 30, used: 27 }),
      ],
      NOW,
    );

    expect(share).toBeCloseTo(0.1);
  });

  it('ignores a window that has elapsed rather than reading it as full', () => {
    const share = remainingShare(
      [
        reading({ used: 4_000, resetAt: new Date(NOW.getTime() - 1) }),
        reading({ bucket: 'search', limit: 30, used: 6 }),
      ],
      NOW,
    );

    // The elapsed one says nothing: its next window is unmeasured until a call
    // is made in it. What is left is the bucket still being counted.
    expect(share).toBeCloseTo(0.8);
  });

  it('knows nothing from nothing', () => {
    expect(remainingShare([], NOW)).toBeNull();
    const elapsed = reading({ used: 10, resetAt: new Date(NOW.getTime() - 1) });
    expect(remainingShare([elapsed], NOW)).toBeNull();
  });

  it('floors at zero when a provider reports an overshoot', () => {
    expect(remainingShare([reading({ limit: 100, used: 130 })], NOW)).toBe(0);
  });
});

describe('allowsOptionalWork', () => {
  it('holds the optional calls back below the reserve', () => {
    expect(allowsOptionalWork(0.5, 10)).toBe(true);
    expect(allowsOptionalWork(0.1, 10)).toBe(false);
    expect(allowsOptionalWork(0, 10)).toBe(false);
  });

  it('spends to the last call when nothing is held back', () => {
    expect(allowsOptionalWork(0, 0)).toBe(true);
  });

  it('degrades nothing on a supposition', () => {
    expect(allowsOptionalWork(null, 90)).toBe(true);
  });
});
