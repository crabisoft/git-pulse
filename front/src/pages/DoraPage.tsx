import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DoraResult, DoraMetric, MetricSnapshotPublic } from '@repo/shared';
import { api, apiErrorInfo } from '../api';

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
                <h3>{t(`dora.metric.${metric}`)}</h3>
                <div className="dora-rows">
                  {rows.map((r, i) => (
                    <div key={i} className="dora-row">
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
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
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
