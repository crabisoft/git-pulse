import { describe, expect, it } from 'vitest';
import { formatValue, humanizeRate } from './doraFormat';

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
});
