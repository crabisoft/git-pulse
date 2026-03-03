import type { DoraMetric, DoraResult } from '@repo/shared';
import { median, type MeasuredResult } from './dora-metrics';

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
export function foldMetric(results: (DoraResult | MeasuredResult)[]): DoraResult | null {
  if (results.length === 0) return null;
  const { metric, unit } = results[0];
  const sampleSize = results.reduce((total, r) => total + r.sampleSize, 0);
  const population = results.flatMap((r) =>
    'population' in r ? r.population.map((s) => s.value ?? 0) : [],
  );

  return {
    metric,
    value: foldValue(unit, results, sampleSize, population),
    unit,
    // The fold is over whatever the filter said; the filter bar states it, and
    // repeating it on the row would claim the reading is about a combination.
    dimensions: {},
    sampleSize,
    samples: mergeSamples(results),
    combinations: results.length,
  };
}

/**
 * Counts add up. A ratio is pooled — weighting by the events it was measured on
 * is what `Σ incidents / Σ deployments` amounts to.
 *
 * A duration is a **median of everything measured**, not a mean of the medians:
 * the page names a median, and averaging medians is neither one. It needs the
 * population, so a reading rebuilt from a stored snapshot — which keeps a value
 * and no events — falls back to the weighted mean it always used.
 */
function foldValue(
  unit: DoraResult['unit'],
  results: DoraResult[],
  sampleSize: number,
  population: number[],
): number {
  if (unit === 'count') return results.reduce((total, r) => total + r.value, 0);
  if (unit === 'seconds' && population.length > 0) return median(population);
  return weightedMean(results, sampleSize);
}

/** One reading per metric, in the order the metrics were first seen. */
export function foldByMetric(results: (DoraResult | MeasuredResult)[]): DoraResult[] {
  const byMetric = new Map<DoraMetric, (DoraResult | MeasuredResult)[]>();
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

/**
 * The most recent events across every folded combination, newest first.
 *
 * A window on the population, never the population itself — which is why the
 * value is computed from `values` above and not from these, and why the page
 * has to say the list is partial.
 */
function mergeSamples(results: DoraResult[]): DoraResult['samples'] {
  return results
    .flatMap((r) => r.samples)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_SAMPLES);
}
