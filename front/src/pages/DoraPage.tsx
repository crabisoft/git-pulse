import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  PAGE_LIMIT_MAX,
  type DoraReport,
  type DoraMetric,
  type MetricSnapshotPublic,
} from '@repo/shared';
import { api, type DoraQuery, type PageQuery } from '../api';
import { dimKey, formatValue } from '../doraFormat';
import { toSearchParams } from '../doraQuery';
import { FILTER_DEBOUNCE_MS, useCancellableLoad, useDebounced } from '../hooks';
import { HelpTip } from '../HelpTip';
import { Pagination } from '../Pagination';
import { RepoFilter } from '../RepoFilter';
import { DimensionFilter, PeriodFilter } from '../Filters';

const METRIC_ORDER: DoraMetric[] = [
  'deployment_frequency',
  'lead_time',
  'change_failure_rate',
  'mttr',
  'coding_time',
  'pickup_time',
  'review_time',
  'deploy_time',
];

/**
 * Module constant so resetting on source change never re-triggers a fetch.
 * Empty everywhere means: rolling window from the settings, every repo, no slice.
 */
const EMPTY_QUERY: DoraQuery = { repos: [], dimensions: {} };

/**
 * Sparklines only need the tail of the series. Snapshots come back in ascending
 * order, so grab the last window rather than the first.
 */
async function loadRecentHistory(
  sourceId: string,
  signal: AbortSignal,
): Promise<MetricSnapshotPublic[]> {
  const first = await api.metrics(sourceId, { limit: PAGE_LIMIT_MAX }, signal);
  if (!first.page.hasMore) return first.items;
  const tail = await api.metrics(
    sourceId,
    { limit: PAGE_LIMIT_MAX, offset: first.page.total - PAGE_LIMIT_MAX },
    signal,
  );
  return tail.items;
}

export function DoraPage({ sourceId, slug }: { sourceId: string; slug: string }) {
  const { t } = useTranslation();
  const [report, setReport] = useState<DoraReport | null>(null);
  const [query, setQuery] = useState<DoraQuery>(EMPTY_QUERY);
  const [history, setHistory] = useState<MetricSnapshotPublic[]>([]);


  // Every filter goes through the debounce: a burst of clicks — repos ticked one
  // at a time, pages stepped through — settles into a single request.
  const settled = useDebounced(query, FILTER_DEBOUNCE_MS);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [live, hist] = await Promise.all([
        api.dora(sourceId, settled, signal),
        loadRecentHistory(sourceId, signal),
      ]);
      setReport(live);
      setHistory(hist);
    },
    [sourceId, settled],
  );
  const { reload, loading, error } = useCancellableLoad(load);

  // Back to the defaults when switching source.
  useEffect(() => {
    setQuery(EMPTY_QUERY);
  }, [sourceId]);

  /** Any new filter invalidates the offset, but keeps the chosen page size. */
  const filter = (partial: Partial<DoraQuery>) =>
    setQuery((q) => ({ ...q, ...partial, offset: 0 }));

  const setPage = (page: PageQuery) => setQuery((q) => ({ ...q, ...page }));

  const results = report?.results.items ?? null;
  const selectedRepos = useMemo(() => new Set(query.repos), [query.repos]);

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
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? t('common.refreshing') : `↻ ${t('common.refresh')}`}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {/* Every filter in one left-aligned bar: period, scope, then slice. */}
      <div className="filters-row">
        <PeriodFilter
          value={{ from: query.from, to: query.to, windowDays: query.windowDays }}
          effective={report?.period}
          onChange={(next) => filter(next)}
          disabled={loading}
        />
        {report && report.repos.length > 1 && (
          <RepoFilter
            repos={report.repos}
            selected={selectedRepos}
            onChange={(next) => filter({ repos: [...next].sort() })}
            disabled={loading}
          />
        )}
        {report && (
          <DimensionFilter
            vocabulary={report.dimensions}
            value={query.dimensions ?? {}}
            onChange={(dimensions) => filter({ dimensions })}
            disabled={loading}
          />
        )}
      </div>

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
                    <Link
                      key={i}
                      className="dora-row"
                      to={`/dora/${slug}/${r.metric}?${toSearchParams({
                        ...query,
                        dimensions: r.dimensions,
                      })}`}
                      title={t('dora.detail.open')}
                    >
                      {/* The sample count sits with the dimensions: the right
                          column has to stay narrow enough to leave the pills
                          room in a grid cell barely 330px wide. */}
                      <div className="dora-main">
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
                        <span className="dora-sample">{t('dora.sample', { count: r.sampleSize })}</span>
                      </div>
                      <div className="dora-right">
                        <Sparkline values={historyByKey.get(`${metric}|${dimKey(r.dimensions)}`) ?? []} />
                        <span className="dora-value">{formatValue(r)}</span>
                        <span className="dora-caret" aria-hidden="true">
                          ›
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {report && (
        <Pagination
          info={report.results.page}
          value={{ limit: query.limit, offset: query.offset }}
          onChange={setPage}
          disabled={loading}
        />
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

