import { useTranslation } from 'react-i18next';
import type { DoraResult, DoraSample } from '@repo/shared';

/** Shared by the metric list and its detail page, which read the same values. */

export function formatValue(r: Pick<DoraResult, 'unit' | 'value'>): string {
  if (r.unit === 'per_day') return humanizeRate(r.value);
  if (r.unit === 'ratio') return `${(r.value * 100).toFixed(1)}%`;
  if (r.unit === 'seconds') return humanizeDuration(r.value);
  // A unit this build has never heard of — a browser holding an older bundle
  // than the API it talks to, or the other way round during an upgrade. The
  // number is still a number, so it is shown as one. Falling through to a
  // duration instead is how a frequency came out labelled in hours and days:
  // wrong, and plausible enough to be believed.
  return String(r.value);
}

/** The cadences a per-day rate can be restated in, finest first. */
const CADENCES = [
  { suffix: '/d', perDays: 1 },
  { suffix: '/w', perDays: 7 },
  { suffix: '/mo', perDays: 30 },
] as const;

export type Cadence = (typeof CADENCES)[number];

/**
 * The cadence a set of per-day rates reads whole in: the finest one in which
 * the largest of them still comes out at one or more.
 *
 * Taken over a set and not over each figure because an **axis** is one scale.
 * Chosen per tick, a chart whose values straddle a deployment a day labels 0.5
 * as `3.5/w` and 1.5 as `1.5/d` — two units on one axis, and a line that reads
 * as going down where it goes up.
 */
export function cadenceFor(perDay: number[]): Cadence {
  const top = Math.max(0, ...perDay);
  return CADENCES.find((cadence) => top * cadence.perDays >= 1) ?? CADENCES[CADENCES.length - 1];
}

export function formatRate(perDay: number, cadence: Cadence): string {
  return `${(perDay * cadence.perDays).toFixed(1)}${cadence.suffix}`;
}

/**
 * One per-day rate, restated over the longest period it still reads whole in.
 *
 * The published bands are a deployment a day, a week, a month, and a shop
 * sitting in the middle two is where the raw figure stops saying anything:
 * `0.1/d` and `0.0/d` are a weekly and a monthly cadence, rounded until they
 * look like the same standstill. So the unit follows the number down —
 * `4.2/d`, `1.4/w`, `0.9/mo` — which is how the cadence gets spoken about
 * anyway. Suffixes left untranslated, like the `2d 4h` below.
 */
export function humanizeRate(perDay: number): string {
  if (perDay <= 0) return '0/d';
  return formatRate(perDay, cadenceFor([perDay]));
}

export function humanizeDuration(sec: number): string {
  if (sec <= 0) return '—';
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(sec)}s`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}


export function SampleDetails({ details }: { details: Record<string, string> }) {
  const { t } = useTranslation();
  return (
    <div className="sample-details">
      {Object.entries(details).map(([k, v]) => (
        <span key={k}>
          {t(`dora.detail.field.${k}`, { defaultValue: k })}: {isIsoDate(v) ? formatDate(v) : v}
        </span>
      ))}
    </div>
  );
}

export function SampleStatus({ status }: { status: DoraSample['status'] }) {
  const { t } = useTranslation();
  if (!status) return <span className="muted">—</span>;
  const key = status === 'other' ? 'unknown' : status;
  return <span className={`pill status-${key}`}>{t(`status.${key}`)}</span>;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value);
}
