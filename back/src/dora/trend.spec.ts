import { describe, expect, it } from 'vitest';
import { foldTrend, matchesFilter, unitOf, type SnapshotRow } from './trend';

/** The specs are about the folding, not about the day the point is stamped with. */
const values = (rows: SnapshotRow[], unit: 'count' | 'ratio' | 'seconds') =>
  foldTrend(rows, unit).map((point) => point.value);

function row(at: string, value: number, dimensions: Record<string, string> = {}): SnapshotRow {
  return { value, dimensions, capturedAt: new Date(at) };
}

describe('matchesFilter', () => {
  it('accepts a combination that carries every pair asked for', () => {
    // The overview filters on a subset — "everything prod, whatever the
    // client" — while a snapshot is stored on a full combination.
    expect(matchesFilter({ type: 'prod', client: 'acme', app: 'api' }, { type: 'prod' })).toBe(true);
  });

  it('accepts everything when nothing is filtered', () => {
    expect(matchesFilter({ type: 'prod' }, {})).toBe(true);
  });

  it('rejects a combination missing one of them', () => {
    expect(matchesFilter({ type: 'prod' }, { type: 'prod', client: 'acme' })).toBe(false);
  });
});

describe('foldTrend', () => {
  it('keeps the last reading of each day', () => {
    // A DORA value is already an aggregate over a rolling window: the state at
    // the end of the day is what that day means.
    const trend = values(
      [
        row('2026-07-28T02:00:00Z', 10),
        row('2026-07-28T22:00:00Z', 14),
        row('2026-07-29T22:00:00Z', 18),
      ],
      'seconds',
    );
    expect(trend).toEqual([14, 18]);
  });

  it('orders the days oldest first, whatever order they arrived in', () => {
    const trend = values([row('2026-07-29T10:00:00Z', 5), row('2026-07-27T10:00:00Z', 1)], 'seconds');
    expect(trend).toEqual([1, 5]);
  });

  it('adds the combinations up for a count', () => {
    // Two clients deploying four times each is eight deployments that day.
    const trend = values(
      [
        row('2026-07-28T22:00:00Z', 4, { client: 'acme' }),
        row('2026-07-28T22:00:00Z', 4, { client: 'globex' }),
      ],
      'count',
    );
    expect(trend).toEqual([8]);
  });

  it('averages the combinations for a duration', () => {
    const trend = values(
      [
        row('2026-07-28T22:00:00Z', 3600, { client: 'acme' }),
        row('2026-07-28T22:00:00Z', 7200, { client: 'globex' }),
      ],
      'seconds',
    );
    expect(trend).toEqual([5400]);
  });

  it('folds combinations rather than letting the newest one win', () => {
    // The regression this exists for: keyed on the day alone, the second
    // client would overwrite the first and the trend would report one of them
    // as if it were the whole scope.
    const trend = values(
      [
        row('2026-07-28T10:00:00Z', 4, { client: 'acme', app: 'api' }),
        row('2026-07-28T11:00:00Z', 4, { client: 'acme', app: 'web' }),
        row('2026-07-28T12:00:00Z', 4, { client: 'globex', app: 'api' }),
      ],
      'count',
    );
    expect(trend).toEqual([12]);
  });

  it('has no trend to draw from no snapshot', () => {
    expect(values([], 'count')).toEqual([]);
  });
});

describe('unitOf', () => {
  it('knows a count from a duration from a ratio', () => {
    // A series is read from a table that stores a number and nothing else, and
    // folding a count is not folding a duration.
    expect(unitOf('deployment_frequency')).toBe('count');
    expect(unitOf('change_failure_rate')).toBe('ratio');
    expect(unitOf('lead_time')).toBe('seconds');
  });
});
