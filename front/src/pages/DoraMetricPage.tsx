import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DoraMetric, DoraResult, MetricSeries } from '@repo/shared';
import { api } from '../api';
import { dimKey, formatDate, formatValue, humanizeDuration, SampleDetails, SampleStatus } from '../doraFormat';
import { fromSearchParams, toSearchParams } from '../doraQuery';
import { FILTER_DEBOUNCE_MS, useCancellableLoad, useDebounced } from '../hooks';
import { HelpTip } from '../HelpTip';
import { Pagination } from '../Pagination';
import type { PageQuery } from '../api';

/** Contributing events shown per page, below the trend. */
const PAGE_SIZE = 10;

/**
 * One metric, one dimension combination: how it moved, then what it is made of.
 *
 * The trend comes from the historised snapshots, the events from the report the
 * list was showing — two different reads, which is why the page fetches both
 * rather than being handed a row.
 */
export function DoraMetricPage({ sourceId, slug }: { sourceId: string; slug: string }) {
  const { t } = useTranslation();
  const { metric } = useParams<{ metric: string }>();
  const [searchParams] = useSearchParams();
  const [report, setReport] = useState<{ result: DoraResult | null; series: MetricSeries } | null>(
    null,
  );
  const [page, setPage] = useState<PageQuery>({ limit: PAGE_SIZE, offset: 0 });

  const query = useMemo(() => fromSearchParams(searchParams), [searchParams]);
  const settled = useDebounced(query, FILTER_DEBOUNCE_MS);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!metric) return;
      const [live, series] = await Promise.all([
        // The whole report, then the one row asked for: a value depends on the
        // period and the repo scope, so it cannot be recomputed in isolation.
        api.dora(sourceId, { ...settled, limit: 200, dimensions: {} }, signal),
        api.metricSeries(
          sourceId,
          { metric, dimensions: settled.dimensions, from: settled.from, to: settled.to },
          signal,
        ),
      ]);
      const wanted = dimKey(settled.dimensions ?? {});
      setReport({
        result:
          live.results.items.find(
            (r) => r.metric === metric && dimKey(r.dimensions) === wanted,
          ) ?? null,
        series,
      });
    },
    [sourceId, metric, settled],
  );
  const { reload, loading, error } = useCancellableLoad(load);

  const backTo = `/dora/${slug}?${toSearchParams(query)}`;
  const dimensions = Object.entries(query.dimensions ?? {});
  const result = report?.result ?? null;
  const samples = result?.samples ?? [];
  const offset = page.offset ?? 0;
  const shown = samples.slice(offset, offset + (page.limit ?? PAGE_SIZE));

  return (
    <div>
      <div className="page-head">
        <div className="metric-head">
          <Link className="back-link" to={backTo}>
            ← {t('dora.title')}
          </Link>
          <h2 className="with-help">
            {t(`dora.metric.${metric}`)}
            <HelpTip text={t(`dora.help.${metric}`)} />
          </h2>
          <div className="metric-head-dims">
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
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? t('common.refreshing') : `↻ ${t('common.refresh')}`}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {result && (
        <section className="panel">
          <div className="metric-current">
            <span className="dora-value">{formatValue(result)}</span>
            <span className="muted">{t('dora.sample', { count: result.sampleSize })}</span>
          </div>
          <MetricTrend series={report!.series} unit={result.unit} metric={metric as DoraMetric} />
        </section>
      )}

      {result && (
        <section className="panel">
          <div className="panel-head">
            <h3>{t('dora.detail.title')}</h3>
            <span className="muted">
              {t('dora.detail.shown', { shown: samples.length, total: result.sampleSize })}
            </span>
          </div>
          <SampleTable samples={shown} isDuration={result.unit === 'seconds'} />
          <Pagination
            info={{
              total: samples.length,
              limit: page.limit ?? PAGE_SIZE,
              offset,
              hasMore: offset + shown.length < samples.length,
            }}
            value={page}
            onChange={setPage}
            disabled={loading}
          />
        </section>
      )}

      {!loading && !result && !error && <p className="muted">{t('dora.detail.gone')}</p>}
    </div>
  );
}

/**
 * How the metric moved over the period. A line: the question is change over
 * time, and one series needs no legend — the heading above names it.
 */
function MetricTrend({
  series,
  unit,
  metric,
}: {
  series: MetricSeries;
  unit: DoraResult['unit'];
  metric: DoraMetric;
}) {
  const { t } = useTranslation();

  if (series.points.length < 2) {
    // One point is not a trend, and none at all is the common case until the
    // scheduled collection has run a few times. Say which it is.
    return (
      <p className="muted chart-empty">
        {t(series.snapshotCount === 0 ? 'dora.trend.noHistory' : 'dora.trend.tooShort')}
      </p>
    );
  }

  const axisValue = (value: number) => formatValue({ unit, value });

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={series.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="at"
            tickFormatter={(at: string) => new Date(at).toLocaleDateString(undefined, { dateStyle: 'short' })}
            stroke="var(--muted)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={axisValue}
            stroke="var(--muted)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip
            // A chart on a screen is interactive by default; reading a value off
            // the grid by eye is not a substitute.
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontSize: '.8rem',
            }}
            labelFormatter={(at) => (typeof at === 'string' ? formatDate(at) : '')}
            formatter={(value) => [axisValue(Number(value)), t(`dora.metric.${metric}`)]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--chart-series)"
            strokeWidth={2}
            // No dot per point — a month of daily buckets would be a bead
            // curtain — but a big one under the cursor.
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="muted chart-note">{t(`dora.trend.bucket.${series.bucket}`)}</p>
    </div>
  );
}

function SampleTable({
  samples,
  isDuration,
}: {
  samples: DoraResult['samples'];
  isDuration: boolean;
}) {
  const { t } = useTranslation();
  if (samples.length === 0) return <p className="muted">{t('dora.detail.noSample')}</p>;

  return (
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
        {samples.map((s, i) => (
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
  );
}
