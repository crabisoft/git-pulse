import { describe, expect, it } from 'vitest';
import type { DoraMetric, DoraResult } from '@repo/shared';
import { foldByMetric, foldMetric } from './aggregate';
import { median, type MeasuredResult } from './dora-metrics';

function result(
  metric: DoraMetric,
  value: number,
  sampleSize: number,
  unit: DoraResult['unit'] = 'seconds',
  samples: DoraResult['samples'] = [],
): DoraResult {
  return { metric, value, unit, dimensions: {}, sampleSize, samples };
}

/** A combination that still carries the population behind its median. */
function measured(metric: DoraMetric, values: number[]): MeasuredResult {
  return {
    ...result(metric, median(values), values.length),
    population: values.map((value, i) => ({
      label: `event ${i}`,
      at: '2026-07-30T10:00:00.000Z',
      value,
    })),
  };
}

describe('foldMetric', () => {
  it('adds counts up rather than averaging them', () => {
    // Two environments deploying four times each is eight deployments, not
    // four: a frequency that fell when a second environment appeared would be
    // reporting the opposite of what happened.
    const folded = foldMetric([
      result('deployment_frequency', 4, 4, 'per_day'),
      result('deployment_frequency', 4, 4, 'per_day'),
    ]);
    expect(folded).toMatchObject({ value: 8, sampleSize: 8 });
  });

  it('takes a median of everything measured, not a mean of the medians', () => {
    // The reading the page names. Six values, so the median is the mean of the
    // two middle ones — 60 and 3600 — which no averaging of 30 and 3600 gives.
    const folded = foldMetric([
      measured('lead_time', [10, 30, 60]),
      measured('lead_time', [3600, 7200, 10_800]),
    ]);

    expect(folded?.value).toBe(1830);
    expect(folded?.sampleSize).toBe(6);
  });

  it('is not dragged by a heavy slice of near-zero values the way a mean is', () => {
    // The report this fixes: a pre-production deployed on merge contributes
    // hundreds of two-second landings, and the reading sank to two seconds
    // while every visible row was in hours.
    const staging = measured('deploy_time', Array.from({ length: 200 }, () => 2));
    const production = measured('deploy_time', Array.from({ length: 60 }, () => 14_400));

    const folded = foldMetric([staging, production]);

    // Still low — most landings really are the fast ones — but it is now a
    // value half the population sits above, which is what a median promises.
    expect(folded?.value).toBe(2);
    expect(folded?.sampleSize).toBe(260);
  });

  it('weighs durations by sample size when the population is gone', () => {
    // A reading rebuilt from a stored snapshot keeps a value and no events;
    // the mean it always used is the only thing left to fold with.
    const folded = foldMetric([result('lead_time', 3600, 300), result('lead_time', 39_600, 3)]);
    expect(folded?.value).toBeCloseTo((3600 * 300 + 39_600 * 3) / 303, 6);
    expect(folded?.sampleSize).toBe(303);
  });

  it('states how many combinations it folded, so a reader can tell', () => {
    expect(foldMetric([result('lead_time', 3600, 2)])?.combinations).toBe(1);
    expect(
      foldMetric([result('lead_time', 3600, 2), result('lead_time', 7200, 2)])?.combinations,
    ).toBe(2);
  });

  it('falls back to the plain mean when nothing was sampled', () => {
    const folded = foldMetric([result('mttr', 60, 0), result('mttr', 120, 0)]);
    expect(folded?.value).toBe(90);
  });

  it('says nothing rather than zero when no slice matched', () => {
    // A metric with no data and a metric worth zero are different statements,
    // and a tile showing "0" for the first one is a lie.
    expect(foldMetric([])).toBeNull();
  });
});

describe('foldByMetric', () => {
  it('answers once per metric, in the order they were computed', () => {
    const folded = foldByMetric([
      result('lead_time', 3600, 2),
      result('mttr', 60, 1),
      result('lead_time', 7200, 2),
    ]);
    expect(folded.map((r) => r.metric)).toEqual(['lead_time', 'mttr']);
    expect(folded[0].value).toBe(5400);
  });

  it('drops the combination from the reading it folded', () => {
    // The filter bar states what the number is about; repeating a combination
    // on the row would claim it is about that one slice.
    const [folded] = foldByMetric([
      result('lead_time', 3600, 2),
      { ...result('lead_time', 7200, 2), dimensions: { type: 'prod' } },
    ]);
    expect(folded.dimensions).toEqual({});
  });

  it('keeps the most recent contributing events across the fold', () => {
    const [folded] = foldByMetric([
      result('lead_time', 3600, 1, 'seconds', [{ label: 'old', at: '2026-07-01T00:00:00Z', value: 1 }]),
      result('lead_time', 7200, 1, 'seconds', [{ label: 'new', at: '2026-07-30T00:00:00Z', value: 2 }]),
    ]);
    expect(folded.samples.map((s) => s.label)).toEqual(['new', 'old']);
  });
});
