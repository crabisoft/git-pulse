import { addsUp, type DoraMetric, type DoraResult, type MetricPoint } from '@repo/shared';

/** A historized reading, as the snapshot table holds it. */
export interface SnapshotRow {
  value: number;
  dimensions: Record<string, string>;
  capturedAt: Date;
}

/**
 * The history behind one tile.
 *
 * Snapshots are stored per dimension **combination** — `{type, client, app}`
 * all at once — while the overview is filtered on a subset of them, often on
 * nothing at all. Asking the store for an exact match therefore finds nothing
 * the moment a filter is on, and finds nothing at all once a classification
 * rule changes the shape of the combinations. The trend went silent and the
 * page looked like it had ignored the rule.
 *
 * So the combinations that satisfy the filter are folded together, the same way
 * the current value is: counts add up, everything else is averaged. The average
 * is unweighted here — a snapshot records a value and not how many events it
 * was measured on — which is why this drives a sparkline and never a figure.
 */
export function foldTrend(rows: SnapshotRow[], unit: DoraResult['unit']): MetricPoint[] {
  /** day → combination → the last reading of that day for that combination. */
  const byDay = new Map<string, Map<string, number>>();

  // Ascending, so the last write for a day and a combination is its latest
  // reading — a DORA value is already an aggregate over a rolling window, and
  // the state at the end of the day is what that day means.
  for (const row of [...rows].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())) {
    const day = row.capturedAt.toISOString().slice(0, 10);
    const combinations = byDay.get(day) ?? new Map<string, number>();
    combinations.set(keyOf(row.dimensions), row.value);
    byDay.set(day, combinations);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, combinations]) => ({
      at: `${day}T00:00:00.000Z`,
      value: fold([...combinations.values()], unit),
    }));
}

/**
 * What a metric is counted in. The computation states it on every result, but
 * a series is read from the snapshot table, which stores a number and nothing
 * else — and folding a count is not folding a duration.
 */
export function unitOf(metric: DoraMetric | string): DoraResult['unit'] {
  if (metric === 'deployment_frequency') return 'per_day';
  if (metric === 'change_failure_rate') return 'ratio';
  return 'seconds';
}

/** Every pair of the filter must be present for a combination to count. */
export function matchesFilter(
  dimensions: Record<string, string>,
  filter: Record<string, string>,
): boolean {
  return Object.entries(filter).every(([key, value]) => dimensions[key] === value);
}

function fold(values: number[], unit: DoraResult['unit']): number {
  if (addsUp(unit)) return values.reduce((total, v) => total + v, 0);
  return values.reduce((total, v) => total + v, 0) / values.length;
}

/** Identifies a combination whatever order its keys were stored in. */
function keyOf(dimensions: Record<string, string>): string {
  return Object.keys(dimensions)
    .sort()
    .map((key) => `${key}=${dimensions[key]}`)
    .join('|');
}
