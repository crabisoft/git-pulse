import { describe, expect, it } from 'vitest';
import { cadenceFor, formatRate, formatValue, humanizeRate } from './doraFormat';

/**
 * How a cadence is written down.
 *
 * The frequency is computed per day, which is the unit the published bands use.
 * Read literally that is unhelpful for most shops: the whole middle of the
 * scale — a deployment a week, one a month — rounds to `0.1/d` and `0.0/d`, two
 * different cadences printed as the same standstill.
 */
describe('humanizeRate', () => {
  it('stays per day for a shop that deploys at least daily', () => {
    expect(humanizeRate(4.2)).toBe('4.2/d');
    expect(humanizeRate(1)).toBe('1.0/d');
  });

  it('steps down to the week rather than rounding a cadence to nothing', () => {
    // 0.14/d is a weekly cadence — `high` on the scale, not a standstill.
    expect(humanizeRate(1 / 7)).toBe('1.0/w');
    expect(humanizeRate(0.5)).toBe('3.5/w');
  });

  it('steps down again to the month', () => {
    expect(humanizeRate(1 / 30)).toBe('1.0/mo');
    expect(humanizeRate(1 / 90)).toBe('0.3/mo');
  });

  it('says nothing deployed rather than an ever smaller fraction', () => {
    expect(humanizeRate(0)).toBe('0/d');
  });
});

describe('formatValue', () => {
  it('reads a rate as a cadence', () => {
    expect(formatValue({ unit: 'per_day', value: 2.5 })).toBe('2.5/d');
  });

  it('reads a ratio as a percentage', () => {
    expect(formatValue({ unit: 'ratio', value: 0.113 })).toBe('11.3%');
  });

  it('reads seconds as a duration', () => {
    expect(formatValue({ unit: 'seconds', value: 97_200 })).toBe('1d 3h');
  });

  it('shows a unit it does not know as the plain number', () => {
    // A bundle and an API a version apart — during an upgrade, or a browser
    // holding a cached build. Durations used to be the fall-through, so a
    // frequency of 63 deployments was drawn as "1m 3s": an axis labelled in
    // hours and days under a heading that says frequency.
    expect(formatValue({ unit: 'count' as never, value: 63 })).toBe('63');
  });
});

/**
 * An axis is one scale.
 *
 * Humanising each tick on its own puts `/w` and `/d` on the same axis — 0.5
 * reads `3.5/w` and 1.5 reads `1.5/d`, so the higher gridline carries the
 * smaller number and the line appears to fall where it rises.
 */
describe('cadenceFor', () => {
  it('states a chart that reaches a deployment a day in days', () => {
    expect(formatRate(0.5, cadenceFor([0.5, 1.2, 2]))).toBe('0.5/d');
    expect(formatRate(2, cadenceFor([0.5, 1.2, 2]))).toBe('2.0/d');
  });

  it('steps the whole axis down when nothing on it reaches a day', () => {
    expect(cadenceFor([0.1, 0.3, 0.5]).suffix).toBe('/w');
    expect(formatRate(0.1, cadenceFor([0.1, 0.3, 0.5]))).toBe('0.7/w');
  });

  it('steps down again for a monthly cadence', () => {
    expect(cadenceFor([0.02, 0.05]).suffix).toBe('/mo');
  });

  it('falls back to the coarsest rather than to no unit at all', () => {
    // A slice that deployed nothing still has an axis to label.
    expect(cadenceFor([0]).suffix).toBe('/mo');
    expect(cadenceFor([]).suffix).toBe('/mo');
  });
});
