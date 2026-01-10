import { describe, expect, it } from 'vitest';
import type { DoraMetric, DoraResult } from '@repo/shared';
import { changeAcross, toFlow } from './flow';

function result(
  metric: DoraMetric,
  value: number,
  sampleSize: number,
  unit: DoraResult['unit'] = 'seconds',
): DoraResult {
  return { metric, value, unit, dimensions: {}, sampleSize, samples: [] };
}

describe('changeAcross', () => {
  it('measures from one end of the trend to the other', () => {
    expect(changeAcross([10, 12, 15])).toBeCloseTo(0.5, 6);
  });

  it('has nothing to measure with fewer than two points', () => {
    expect(changeAcross([])).toBeNull();
    expect(changeAcross([4])).toBeNull();
  });

  it('refuses to divide by a first point of zero', () => {
    // Every rise from nothing is infinite; reporting one as a percentage says
    // less than saying nothing.
    expect(changeAcross([0, 9])).toBeNull();
  });
});

describe('toFlow', () => {
  it('reads a rising deployment frequency as progress', () => {
    const flow = toFlow(
      'deployment_frequency',
      [result('deployment_frequency', 4.2, 42, 'count')],
      [2, 3, 4.2],
    );
    expect(flow?.improving).toBe(true);
  });

  it('reads a rising restore time as the opposite', () => {
    // Same sign, other meaning: this is the table the front should not hold.
    const flow = toFlow('mttr', [result('mttr', 2460, 12)], [1800, 2100, 2460]);
    expect(flow?.delta).toBeGreaterThan(0);
    expect(flow?.improving).toBe(false);
  });

  it('reads a falling lead time as progress', () => {
    const flow = toFlow('lead_time', [result('lead_time', 24_000, 30)], [40_000, 30_000, 24_000]);
    expect(flow?.improving).toBe(true);
  });

  it('carries no verdict when there is no history to compare against', () => {
    const flow = toFlow('lead_time', [result('lead_time', 24_000, 30)], []);
    expect(flow?.delta).toBeNull();
    expect(flow?.improving).toBeNull();
  });

  it('drops a metric nothing was computed for', () => {
    expect(toFlow('mttr', [], [1, 2])).toBeNull();
  });
});
