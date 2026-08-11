import { addsUp, type DoraMetric, type DoraResult, type OverviewFlow } from '@repo/shared';
import { foldMetric } from '../dora/aggregate';

/**
 * What the overview reports on. The four keys of the DORA report and nothing
 * else: the breakdown metrics — coding, pickup, review, deploy time — answer
 * "where does the delay sit", which is a question for the DORA page, not for a
 * screen somebody glances at.
 */
export const OVERVIEW_METRICS: readonly DoraMetric[] = [
  'deployment_frequency',
  'lead_time',
  'change_failure_rate',
  'mttr',
];

/**
 * One reading per metric, with the movement behind it.
 *
 * `slices` is the period cut into consecutive pieces, oldest first, each
 * carrying the same folded readings as the whole — so a point on a line and
 * the number beside it are one computation over different bounds.
 */
export function flowsFrom(results: DoraResult[], slices: DoraResult[][]): OverviewFlow[] {
  return OVERVIEW_METRICS.map((metric) => {
    const matching = results.filter((r) => r.metric === metric);
    if (matching.length === 0) return null;
    return toFlow(metric, matching, trendOf(metric, matching[0].unit, slices));
  }).filter((flow): flow is OverviewFlow => flow !== null);
}

/**
 * How one metric moved across the slices.
 *
 * A slice with no reading is not a zero for every metric, and treating it as
 * one would draw a cliff where there is only silence: nothing deployed is
 * genuinely zero deployments a day, while nothing merged is not a lead time of
 * zero, it is the absence of one. So whatever adds up fills the gap and the
 * rest step over it — which shortens the line rather than inventing a point.
 */
export function trendOf(
  metric: DoraMetric,
  unit: DoraResult['unit'],
  slices: DoraResult[][],
): number[] {
  const points = slices.map((slice) => slice.find((r) => r.metric === metric) ?? null);
  return addsUp(unit)
    ? points.map((point) => point?.value ?? 0)
    : points.filter((point): point is DoraResult => point !== null).map((point) => point.value);
}

/**
 * Whether a rising value is good news. Not derivable from the number: more
 * deployments is progress, a longer restore time is not, and the front should
 * not have to hold that table to colour an arrow.
 */
const RISING_IS_BETTER: Partial<Record<DoraMetric, boolean>> = {
  deployment_frequency: true,
  lead_time: false,
  change_failure_rate: false,
  mttr: false,
};

/**
 * A metric as the overview reads it.
 *
 * The change is measured across the trend rather than against a freshly
 * computed previous window: recomputing would mean a second full round of
 * connector calls for one arrow, and the historized snapshots already describe
 * the same movement.
 */
export function toFlow(metric: DoraMetric, results: DoraResult[], trend: number[]): OverviewFlow | null {
  const folded = foldMetric(results);
  if (!folded) return null;
  const delta = changeAcross(trend);
  return {
    metric,
    value: folded.value,
    unit: folded.unit,
    sampleSize: folded.sampleSize,
    trend,
    delta,
    improving: delta === null ? null : delta > 0 === (RISING_IS_BETTER[metric] ?? true),
  };
}

/**
 * Movement from one end of the trend to the other, as a signed ratio — the
 * first slice of the period against its last, now that the trend is cut from
 * the period rather than read from a rolling series.
 *
 * Null when there is nothing to measure across: fewer than two points, or a
 * first point of zero, where every change is infinite.
 */
export function changeAcross(trend: number[]): number | null {
  if (trend.length < 2) return null;
  const first = trend[0];
  const last = trend[trend.length - 1];
  if (first === 0) return null;
  return (last - first) / Math.abs(first);
}

