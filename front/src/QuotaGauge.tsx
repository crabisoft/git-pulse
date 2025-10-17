import { useTranslation } from 'react-i18next';
import type { ApiQuotaPublic } from '@repo/shared';

/**
 * Consumption of one provider rate-limit bucket.
 *
 * Shows what was measured and nothing more: a reading whose window has already
 * elapsed is drawn as expired rather than refreshed to zero, because the
 * counter of the new window is only known once a call has been made in it.
 */
export function QuotaGauge({ quota, now = Date.now() }: { quota: ApiQuotaPublic; now?: number }) {
  const { t } = useTranslation();
  const resetMs = new Date(quota.resetAt).getTime();
  const elapsed = resetMs <= now;
  const share = quota.limit > 0 ? quota.used / quota.limit : 0;
  const pct = Math.min(100, Math.max(0, Math.round(share * 100)));
  const level = elapsed ? 'idle' : pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'ok';

  return (
    <div className="quota" title={t('sources.quota.observedAt', { at: formatDate(quota.observedAt) })}>
      <div className="quota-head">
        <span className="quota-bucket">{quota.bucket}</span>
        <span className="quota-count">
          {quota.used.toLocaleString()} / {quota.limit.toLocaleString()}
        </span>
        <span className="quota-window">
          {elapsed
            ? t('sources.quota.elapsed')
            : t('sources.quota.resetsIn', { delay: formatDelay(resetMs - now) })}
        </span>
        {quota.origin === 'declared' && (
          <span className="quota-origin" title={t('sources.quota.declaredHint')}>
            {t('sources.quota.declared')}
          </span>
        )}
      </div>
      <div
        className={`quota-bar ${level}`}
        role="progressbar"
        aria-label={t('sources.quota.label', { bucket: quota.bucket })}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Coarse on purpose: a rate-limit window is never read to the second. */
function formatDelay(ms: number): string {
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h}h` : `${h}h${String(rest).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}
