import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DoraResult, DoraMetric, DoraSample, MetricSnapshotPublic } from '@repo/shared';
import { api, apiErrorInfo } from '../api';
import { CancelIcon } from '../icons';
import { HelpTip } from '../HelpTip';

const METRIC_ORDER: DoraMetric[] = [
  'deployment_frequency',
  'lead_time',
  'change_failure_rate',
  'mttr',
  'coding_time',
  'pickup_time',
  'review_time',
];

export function DoraPage({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const [results, setResults] = useState<DoraResult[] | null>(null);
  const [history, setHistory] = useState<MetricSnapshotPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DoraResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [live, hist] = await Promise.all([api.dora(sourceId), api.metrics(sourceId)]);
      setResults(live);
      setHistory(hist);
    } catch (e) {
      const { code, params } = apiErrorInfo(e);
      setError(t(code, params));
    } finally {
      setLoading(false);
    }
  }, [sourceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const historyByKey = new Map<string, number[]>();
  for (const s of history) {
    const key = `${s.metric}|${dimKey(s.dimensions)}`;
    const bucket = historyByKey.get(key);
    if (bucket) bucket.push(s.value);
    else historyByKey.set(key, [s.value]);
  }

  return (
    <div>
      <div className="page-head">
        <h2>{t('dora.title')}</h2>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? t('common.refreshing') : `↻ ${t('common.refresh')}`}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {results && results.length === 0 && <p className="muted">{t('dora.empty')}</p>}

      {results && results.length > 0 && (
        <div className="dora-grid">
          {METRIC_ORDER.map((metric) => {
            const rows = results.filter((r) => r.metric === metric);
            if (rows.length === 0) return null;
            return (
              <section key={metric} className="panel">
                <h3 className="with-help">
                  {t(`dora.metric.${metric}`)}
                  <HelpTip text={t(`dora.help.${metric}`)} />
                </h3>
                <div className="dora-rows">
                  {rows.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      className="dora-row"
                      onClick={() => setDetail(r)}
                      title={t('dora.detail.open')}
                      disabled={r.samples.length === 0}
                    >
                      <div className="dora-dims">
                        {Object.keys(r.dimensions).length === 0 ? (
                          <span className="muted">{t('dora.global')}</span>
                        ) : (
                          Object.entries(r.dimensions).map(([k, v]) => (
                            <span key={k} className="pill attr">
                              <b>{k}</b>={v}
                            </span>
                          ))
                        )}
                      </div>
                      <div className="dora-right">
                        <Sparkline values={historyByKey.get(`${metric}|${dimKey(r.dimensions)}`) ?? []} />
                        <span className="dora-value">{formatValue(r)}</span>
                        <span className="dora-sample">{t('dora.sample', { count: r.sampleSize })}</span>
                        <span className="dora-caret" aria-hidden="true">
                          ›
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {detail && <DetailDialog result={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** Contributing events behind one metric value. */
function DetailDialog({ result, onClose }: { result: DoraResult; onClose: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dimensions = Object.entries(result.dimensions);
  const isDuration = result.unit === 'seconds';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t(`dora.metric.${result.metric}`)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h3 className="with-help">
              {t(`dora.metric.${result.metric}`)}
              <HelpTip text={t(`dora.help.${result.metric}`)} />
            </h3>
            <div className="modal-sub">
              <span className="dora-value">{formatValue(result)}</span>
              {dimensions.length === 0 ? (
                <span className="muted">{t('dora.global')}</span>
              ) : (
                <div className="pills">
                  {dimensions.map(([k, v]) => (
                    <span key={k} className="pill attr">
                      <b>{k}</b>={v}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button className="btn icon" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
            <CancelIcon />
          </button>
        </div>

        <p className="muted modal-count">
          {t('dora.detail.shown', { shown: result.samples.length, total: result.sampleSize })}
        </p>

        <div className="modal-body">
          <table className="data">
            <thead>
              <tr>
                <th>{t('dora.detail.cols.item')}</th>
                <th>{t('dora.detail.cols.date')}</th>
                {isDuration ? (
                  <th className="num">{t('dora.detail.cols.duration')}</th>
                ) : (
                  <th>{t('dashboard.cols.status')}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {result.samples.map((s, i) => (
                <tr key={i}>
                  <td className="mono">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.label}
                      </a>
                    ) : (
                      s.label
                    )}
                    {s.details && <SampleDetails details={s.details} />}
                  </td>
                  <td>{formatDate(s.at)}</td>
                  {isDuration ? (
                    <td className="num">{s.value === null ? '—' : humanizeDuration(s.value)}</td>
                  ) : (
                    <td>
                      <SampleStatus status={s.status} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SampleDetails({ details }: { details: Record<string, string> }) {
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

function SampleStatus({ status }: { status: DoraSample['status'] }) {
  const { t } = useTranslation();
  if (!status) return <span className="muted">—</span>;
  const key = status === 'other' ? 'unknown' : status;
  return <span className={`pill status-${key}`}>{t(`status.${key}`)}</span>;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="spark-empty">—</span>;
  const w = 84;
  const h = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function formatValue(r: DoraResult): string {
  if (r.unit === 'count') return String(r.value);
  if (r.unit === 'ratio') return `${(r.value * 100).toFixed(1)}%`;
  return humanizeDuration(r.value);
}

function humanizeDuration(sec: number): string {
  if (sec <= 0) return '—';
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(sec)}s`;
}

function dimKey(dimensions: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(dimensions).sort()) sorted[k] = dimensions[k];
  return JSON.stringify(sorted);
}
