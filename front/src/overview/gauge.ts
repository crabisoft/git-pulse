import { DORA_TIER_THRESHOLDS, DORA_TIERS, doraTier, type DoraMetric, type DoraTier } from '@repo/shared';

/**
 * Where a reading sits on the arc, in degrees.
 *
 * The half-circle runs from 180° on the left to 0° on the right, one 45° band
 * per DORA tier, worst on the left. Placing the marker inside its band rather
 * than at its centre is what makes the gauge worth drawing: "just inside
 * elite" and "comfortably elite" are the same word and not the same situation.
 */
const BAND_DEGREES = 45;

/**
 * How far past the outermost edge counts as the end of the scale.
 *
 * Both extreme bands are open — there is no worst possible lead time, and no
 * best possible deployment frequency — so the needle has to saturate
 * somewhere. Twice the edge, which keeps the common cases moving and stops a
 * single outlier from pinning the marker to the rail for good.
 */
const SATURATION = 2;

export function tierOf(metric: DoraMetric, tierValue: number): DoraTier | null {
  return doraTier(metric, tierValue);
}

/** Degrees from the right-hand end of the arc; null when the metric has no scale. */
export function gaugeAngle(metric: DoraMetric, tierValue: number): number | null {
  const edges = DORA_TIER_THRESHOLDS[metric];
  const tier = doraTier(metric, tierValue);
  if (!edges || !tier) return null;

  const band = DORA_TIERS.indexOf(tier);
  // Bands are laid out worst-first from the left, so the band's own span runs
  // from `start` degrees down towards the right-hand end.
  const start = (DORA_TIERS.length - 1 - band) * BAND_DEGREES;
  return start + BAND_DEGREES * within(metric, tier, tierValue, edges);
}

/**
 * How far into its band a value sits, 0 at the good end and 1 at the bad one.
 * Both open-ended bands saturate rather than run off the arc.
 */
function within(
  metric: DoraMetric,
  tier: DoraTier,
  value: number,
  [elite, high, medium]: [number, number, number],
): number {
  // Frequency is the one metric where a bigger number is a better one, so its
  // bands are read from the other side.
  if (metric === 'deployment_frequency') {
    if (tier === 'elite') return clamp(1 - (value - elite) / (elite * (SATURATION - 1)));
    if (tier === 'high') return clamp((elite - value) / (elite - high));
    if (tier === 'medium') return clamp((high - value) / (high - medium));
    return clamp(1 - value / medium);
  }

  if (tier === 'elite') return clamp(value / elite);
  if (tier === 'high') return clamp((value - elite) / (high - elite));
  if (tier === 'medium') return clamp((value - high) / (medium - high));
  return clamp((value - medium) / (medium * (SATURATION - 1)));
}

function clamp(ratio: number): number {
  if (!Number.isFinite(ratio)) return 1;
  return Math.min(1, Math.max(0, ratio));
}
