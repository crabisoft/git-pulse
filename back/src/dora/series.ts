import type { DoraPeriod } from '@repo/shared';

const DAY_MS = 86_400_000;

/**
 * A period cut into consecutive slices, oldest first.
 *
 * What a trend is drawn from. Each slice is a period in its own right and the
 * metrics are computed over it exactly as they are over the whole, so a point
 * on the line means what the number beside it means — one slice's worth of it.
 *
 * Two rules bound the cut, and both exist to keep a point worth plotting:
 *
 * - **Never more than `maxSlices`.** A sparkline is a word wide; past a dozen
 *   points it is texture.
 * - **Never finer than a day.** Deployments land on days and merges on
 *   afternoons: slicing a two-day period into twelve produces eleven empty
 *   readings and one spike, which says less than four honest points.
 *
 * Slices are disjoint — each starts a millisecond after the last one ends,
 * because a period includes both its bounds and an event landing on the seam
 * would otherwise be counted twice. They carry no `windowDays`: their bounds
 * are explicit, which is exactly what that field being null means.
 */
export function sliceRange(period: DoraPeriod, maxSlices: number): DoraPeriod[] {
  const from = new Date(period.from).getTime();
  const to = new Date(period.to).getTime();
  const span = to - from;
  if (maxSlices < 1 || span <= 0) return [];

  const count = Math.max(1, Math.min(Math.floor(maxSlices), Math.floor(span / DAY_MS)));
  const step = span / count;

  return Array.from({ length: count }, (_, i) => {
    const start = Math.round(from + i * step);
    // The last slice ends on the period's own bound rather than a rounded
    // step: a trend that stopped a second short of the report it illustrates
    // would drop whatever happened in that second.
    const end = i === count - 1 ? to : Math.round(from + (i + 1) * step) - 1;
    return { from: new Date(start).toISOString(), to: new Date(end).toISOString(), windowDays: null };
  });
}
