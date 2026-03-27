import { describe, expect, it } from 'vitest';
import type { DoraMetric, DoraResult } from '@repo/shared';
import { changeAcross, flowsFrom, toFlow, trendOf } from './flow';

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

describe('trendOf', () => {
  it('reads one point per slice, in the order the slices came', () => {
    const slices = [
      [result('lead_time', 40_000, 5)],
      [result('lead_time', 30_000, 6)],
      [result('lead_time', 24_000, 4)],
    ];
    expect(trendOf('lead_time', 'seconds', slices)).toEqual([40_000, 30_000, 24_000]);
  });

  it('counts a slice with nothing in it as zero', () => {
    // Nothing deployed that week is genuinely zero deployments, and a line
    // that stepped over it would hide the quiet week entirely.
    const slices = [
      [result('deployment_frequency', 12, 12, 'count')],
      [],
      [result('deployment_frequency', 8, 8, 'count')],
    ];
    expect(trendOf('deployment_frequency', 'count', slices)).toEqual([12, 0, 8]);
  });

  it('steps over a slice that measured no duration rather than calling it zero', () => {
    // Nothing merged is not a lead time of zero: it is the absence of one, and
    // plotting it would draw a cliff where there is only silence.
    const slices = [[result('lead_time', 40_000, 5)], [], [result('lead_time', 24_000, 4)]];
    expect(trendOf('lead_time', 'seconds', slices)).toEqual([40_000, 24_000]);
  });

  it('ignores the other metrics sharing a slice', () => {
    const slices = [[result('mttr', 900, 2), result('lead_time', 40_000, 5)]];
    expect(trendOf('mttr', 'seconds', slices)).toEqual([900]);
  });
});

describe('flowsFrom', () => {
  it('gives each metric the movement of its own slices', () => {
    const flows = flowsFrom(
      [result('deployment_frequency', 20, 20, 'count'), result('mttr', 900, 2)],
      [
        [result('deployment_frequency', 12, 12, 'count'), result('mttr', 1800, 1)],
        [result('deployment_frequency', 8, 8, 'count'), result('mttr', 900, 1)],
      ],
    );

    expect(flows.map((f) => f.metric)).toEqual(['deployment_frequency', 'mttr']);
    expect(flows[0].trend).toEqual([12, 8]);
    expect(flows[1].trend).toEqual([1800, 900]);
    // Fewer deployments and a faster restore: opposite readings of a fall.
    expect(flows[0].improving).toBe(false);
    expect(flows[1].improving).toBe(true);
  });

  it('reports nothing for a metric the period produced no reading for', () => {
    const flows = flowsFrom([result('mttr', 900, 2)], [[result('mttr', 900, 2)]]);
    expect(flows.map((f) => f.metric)).toEqual(['mttr']);
  });

  it('leaves a metric without slices its value and no line', () => {
    const [flow] = flowsFrom([result('mttr', 900, 2)], []);
    expect(flow.value).toBe(900);
    expect(flow.trend).toEqual([]);
    expect(flow.delta).toBeNull();
  });
});
