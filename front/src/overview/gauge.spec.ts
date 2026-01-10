import { describe, expect, it } from 'vitest';
import { doraTier } from '@repo/shared';
import { gaugeAngle, tierOf, toTierValue } from './gauge';

describe('toTierValue', () => {
  it('turns a deployment count into the per-day rate the bands are published in', () => {
    // The metric counts deployments over the window; the report's scale is
    // per day. Reading one against the other would rate a quiet month elite.
    expect(toTierValue('deployment_frequency', 60, 30)).toBe(2);
  });

  it('leaves a duration in the unit it was computed in', () => {
    expect(toTierValue('lead_time', 3600, 30)).toBe(3600);
  });

  it('falls back to the raw count when the period named no length', () => {
    // Explicit bounds were asked for. The raw count reads as a busier scale,
    // never as a better tier than deserved.
    expect(toTierValue('deployment_frequency', 60, null)).toBe(60);
  });
});

describe('tierOf', () => {
  it('rates a daily deployment cadence at the top', () => {
    expect(tierOf('deployment_frequency', 1.5)).toBe('elite');
  });

  it('rates a monthly one at the bottom', () => {
    expect(tierOf('deployment_frequency', 1 / 45)).toBe('low');
  });

  it('reads a duration the other way round', () => {
    // More is better for one metric and worse for every other.
    expect(tierOf('lead_time', 1_800)).toBe('elite');
    expect(tierOf('lead_time', 5_184_000)).toBe('low');
  });

  it('has nothing to say about a metric the report does not scale', () => {
    expect(doraTier('review_time', 3600)).toBeNull();
    expect(tierOf('review_time', 3600)).toBeNull();
  });
});

describe('gaugeAngle', () => {
  const RIGHT_END = 0;
  const LEFT_END = 180;

  it('places a reading inside its own band, not at its centre', () => {
    // "Just inside elite" and "comfortably elite" are the same word and not
    // the same situation — which is the whole reason to draw an arc.
    const barely = gaugeAngle('lead_time', 3_599)!;
    const comfortably = gaugeAngle('lead_time', 60)!;
    expect(barely).toBeGreaterThan(comfortably);
    expect(barely).toBeLessThanOrEqual(45);
    expect(comfortably).toBeGreaterThanOrEqual(RIGHT_END);
  });

  it('keeps the bands in order, worst on the left', () => {
    const angles = [
      gaugeAngle('lead_time', 60)!,
      gaugeAngle('lead_time', 100_000)!,
      gaugeAngle('lead_time', 1_000_000)!,
      gaugeAngle('lead_time', 10_000_000)!,
    ];
    expect(angles).toEqual([...angles].sort((a, b) => a - b));
  });

  it('saturates rather than running off the arc', () => {
    // Both extreme bands are open: there is no worst possible lead time.
    expect(gaugeAngle('lead_time', Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(LEFT_END);
    expect(gaugeAngle('deployment_frequency', 10_000)).toBeGreaterThanOrEqual(RIGHT_END);
  });

  it('reads the frequency band from the other side', () => {
    const busier = gaugeAngle('deployment_frequency', 4)!;
    const quieter = gaugeAngle('deployment_frequency', 1)!;
    expect(busier).toBeLessThan(quieter);
  });

  it('has no angle for a metric with no scale', () => {
    expect(gaugeAngle('review_time', 3600)).toBeNull();
  });
});
