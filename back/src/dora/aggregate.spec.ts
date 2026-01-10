import { describe, expect, it } from 'vitest';
import type { DoraMetric, DoraResult } from '@repo/shared';
import { foldByMetric, foldMetric } from './aggregate';

function result(
  metric: DoraMetric,
  value: number,
  sampleSize: number,
  unit: DoraResult['unit'] = 'seconds',
  samples: DoraResult['samples'] = [],
): DoraResult {
  return { metric, value, unit, dimensions: {}, sampleSize, samples };
}

describe('foldMetric', () => {
  it('adds counts up rather than averaging them', () => {
    // Two environments deploying four times each is eight deployments, not
    // four: a frequency that fell when a second environment appeared would be
    // reporting the opposite of what happened.
    const folded = foldMetric([
      result('deployment_frequency', 4, 4, 'count'),
      result('deployment_frequency', 4, 4, 'count'),
    ]);
    expect(folded).toMatchObject({ value: 8, sampleSize: 8 });
  });

  it('weighs durations by how many events they were measured on', () => {
    // One slice of 300 events at 1h, one of 3 events at 11h: the plain mean
    // would read 6h, which describes neither.
    const folded = foldMetric([result('lead_time', 3600, 300), result('lead_time', 39_600, 3)]);
    expect(folded?.value).toBeCloseTo((3600 * 300 + 39_600 * 3) / 303, 6);
    expect(folded?.sampleSize).toBe(303);
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
