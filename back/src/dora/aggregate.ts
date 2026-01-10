import type { DoraMetric, DoraResult } from '@repo/shared';

/**
 * Contributing events a folded metric carries. The same cap each combination
 * was already held to: a fold of twelve slices is still one reading, and a
 * list of six hundred events is not what a detail page is for.
 */
const MAX_SAMPLES = 50;

/**
 * Folding several dimension combinations into one reading.
 *
 * A metric is computed per combination — one value for `{type: prod, client:
 * acme}`, another for `{type: prod, client: globex}`. Every screen that reports
 * over a filter rather than over a combination has to put those back together,
 * and there is exactly one right way to do it: counts add up, while durations
 * and ratios are averaged over the number of events they were measured on, so
 * a slice built on three events never weighs as much as one built on three
 * hundred.
 *
 * Written once here because two readers need it — the metric list and the
 * overview — and two implementations of "what is the lead time over this
 * filter" would eventually disagree.
 */
export function foldMetric(results: DoraResult[]): DoraResult | null {
  if (results.length === 0) return null;
  const { metric, unit } = results[0];
  const sampleSize = results.reduce((total, r) => total + r.sampleSize, 0);

  const value =
    unit === 'count'
      ? results.reduce((total, r) => total + r.value, 0)
      : weightedMean(results, sampleSize);

  return {
    metric,
    value,
    unit,
    // The fold is over whatever the filter said; the filter bar states it, and
    // repeating it on the row would claim the reading is about a combination.
    dimensions: {},
    sampleSize,
    samples: mergeSamples(results),
  };
}

/** One reading per metric, in the order the metrics were first seen. */
export function foldByMetric(results: DoraResult[]): DoraResult[] {
  const byMetric = new Map<DoraMetric, DoraResult[]>();
  for (const result of results) {
    const bucket = byMetric.get(result.metric);
    if (bucket) bucket.push(result);
    else byMetric.set(result.metric, [result]);
  }

  return [...byMetric.values()]
    .map(foldMetric)
    .filter((result): result is DoraResult => result !== null);
}

/**
 * No samples to weigh with: fall back to the plain mean rather than dividing
 * by zero. It happens when every slice is empty, where the mean of nothing is
 * the only honest answer.
 */
function weightedMean(results: DoraResult[], sampleSize: number): number {
  if (sampleSize > 0) {
    return results.reduce((total, r) => total + r.value * r.sampleSize, 0) / sampleSize;
  }
  return results.reduce((total, r) => total + r.value, 0) / results.length;
}

/** The most recent events across every folded combination, newest first. */
function mergeSamples(results: DoraResult[]): DoraResult['samples'] {
  return results
    .flatMap((r) => r.samples)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_SAMPLES);
}
