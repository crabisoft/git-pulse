import { useTranslation } from 'react-i18next';
import type { DoraResult, DoraSample } from '@repo/shared';

/** Shared by the metric list and its detail page, which read the same values. */

export function formatValue(r: Pick<DoraResult, 'unit' | 'value'>): string {
  if (r.unit === 'count') return String(r.value);
  if (r.unit === 'ratio') return `${(r.value * 100).toFixed(1)}%`;
  return humanizeDuration(r.value);
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
