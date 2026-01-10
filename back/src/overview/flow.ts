import type { DoraMetric, DoraResult, OverviewFlow } from '@repo/shared';
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
 * Movement from one end of the trend to the other, as a signed ratio. Null
 * when there is nothing to measure across: fewer than two points, or a first
 * point of zero, where every change is infinite.
 */
export function changeAcross(trend: number[]): number | null {
  if (trend.length < 2) return null;
  const first = trend[0];
  const last = trend[trend.length - 1];
  if (first === 0) return null;
  return (last - first) / Math.abs(first);
}

