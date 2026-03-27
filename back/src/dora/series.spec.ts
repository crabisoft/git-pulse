import { describe, expect, it } from 'vitest';
import { sliceRange } from './series';

const period = (from: string, to: string) => ({ from, to, windowDays: null });

describe('sliceRange', () => {
  it('cuts the period into as many slices as asked for', () => {
    const slices = sliceRange(period('2026-07-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z'), 10);

    expect(slices).toHaveLength(10);
    expect(slices[0].from).toBe('2026-07-01T00:00:00.000Z');
    expect(slices[9].to).toBe('2026-07-31T00:00:00.000Z');
  });

  it('leaves no gap and no overlap between one slice and the next', () => {
    // A period includes both its bounds, so an event landing on the seam would
    // be counted in both slices — and one landing in a gap in neither.
    const slices = sliceRange(period('2026-07-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z'), 6);

    for (let i = 1; i < slices.length; i += 1) {
      const previousEnd = new Date(slices[i - 1].to).getTime();
      expect(new Date(slices[i].from).getTime()).toBe(previousEnd + 1);
    }
  });

  it('never cuts finer than a day', () => {
    // Twelve slices of a three-day period would be six-hour windows: eleven
    // empty readings and one spike, which says less than three honest points.
    const slices = sliceRange(period('2026-07-28T00:00:00.000Z', '2026-07-31T00:00:00.000Z'), 12);

    expect(slices).toHaveLength(3);
  });

  it('still answers with one slice for a period shorter than a day', () => {
    const slices = sliceRange(period('2026-07-31T08:00:00.000Z', '2026-07-31T20:00:00.000Z'), 12);

    expect(slices).toHaveLength(1);
    expect(slices[0]).toEqual({
      from: '2026-07-31T08:00:00.000Z',
      to: '2026-07-31T20:00:00.000Z',
      windowDays: null,
    });
  });

  it('ends the last slice on the period itself rather than a rounded step', () => {
    // Thirty-one days over seven slices does not divide; the remainder has to
    // land inside the trend rather than after it.
    const slices = sliceRange(period('2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'), 7);

    expect(slices.at(-1)?.to).toBe('2026-08-01T00:00:00.000Z');
  });

  it('states no window, its bounds being explicit', () => {
    const [slice] = sliceRange(period('2026-07-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z'), 3);
    expect(slice.windowDays).toBeNull();
  });

  it('has nothing to cut when the period is a point, or nothing is asked for', () => {
    const instant = period('2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
    expect(sliceRange(instant, 12)).toEqual([]);
    expect(sliceRange(period('2026-07-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z'), 0)).toEqual([]);
  });
});
