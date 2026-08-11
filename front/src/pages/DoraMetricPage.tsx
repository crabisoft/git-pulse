import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataList } from '../DataList';
import { Link, useParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DoraMetric,
  DoraReport,
  DoraResult,
  DoraSample,
  MetricSeries,
  Page,
} from '@repo/shared';
import { api, type DoraQuery } from '../api';
import { formatDate, formatValue, humanizeDuration, SampleDetails, SampleStatus } from '../doraFormat';
import { toSearchParams } from '../doraQuery';
import { useCancellableLoad } from '../hooks';
import { doraCodec, useUrlQuery } from '../urlQuery';
import { DimensionFilter, PeriodFilter } from '../Filters';
import { HelpTip } from '../HelpTip';
import { Pagination } from '../Pagination';
import type { PageQuery } from '../api';

/** Contributing events shown per page, below the trend. */
const PAGE_SIZE = 10;

/**
 * One metric under the filters the list was showing: how it moved, then what it
 * is made of.
 *
 * The filters travel in the URL rather than being re-picked on arrival — a
 * value computed over another period or another slice is a different number,
 * and a detail that disagreed with the block it was opened from would be worse
 * than no detail. They are also editable here, and the same bar the list shows:
 * arriving with a question about one metric and having to walk back to the list
 * to narrow it is the same click twice, and the answer that came back was the
 * one the list already gave. Whatever is picked here travels back up the
 * breadcrumb, which serialises the query it is holding.
 *
 * The trend comes from the historised snapshots and the events from the report,
 * which is why the page fetches both rather than being handed a row.
 */
export function DoraMetricPage({ sourceId, slug }: { sourceId: string; slug: string }) {
  const { t } = useTranslation();
  const { metric } = useParams<{ metric: string }>();
  // The report whole rather than the one reading pulled out of it: the filter
  // bar needs the dimension vocabulary and the period the backend resolved,
  // which are answers to the same request.
  const [report, setReport] = useState<{ live: DoraReport; series: MetricSeries } | null>(null);
  const [page, setPage] = useState<PageQuery>({ limit: PAGE_SIZE, offset: 0 });
  const [events, setEvents] = useState<Page<DoraSample> | null>(null);

  const { query, setQuery, settled } = useUrlQuery(doraCodec);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!metric) return;
      const [live, series] = await Promise.all([
        // The same report the list was showing, filters included: a value
        // depends on the period and the scope, so it cannot be recomputed in
        // isolation — and the report already folds it over the filter.
        api.dora(sourceId, settled, signal),
        // The same three the report is given: a period picked as a rolling
        // window has no bounds to pass, and the chart would have covered every
        // snapshot ever taken beside a value covering ninety days.
        api.metricSeries(
          sourceId,
          {
            metrics: [metric],
            dimensions: settled.dimensions,
            from: settled.from,
            to: settled.to,
            windowDays: settled.windowDays,
          },
          signal,
        ),
      ]);
      // One metric asked for, one series back.
      setReport({ live, series: series[0] });
    },
    [sourceId, metric, settled],
  );
  const { reload, loading, error } = useCancellableLoad(load);

  /**
   * The events, paged by the server.
   *
   * A load of its own, keyed on the page as well: turning a page must not
   * recompute the report, which is where the connector calls are. The reading
   * carries its own most recent few, but a list somebody pages through has to
   * be the whole population.
   */
  const loadSamples = useCallback(
    async (signal: AbortSignal) => {
      if (!metric) return;
      setEvents(
        await api.doraSamples(sourceId, { ...settled, metric: metric as DoraMetric }, page, signal),
      );
    },
    [sourceId, metric, settled, page],
  );
  useCancellableLoad(loadSamples);

  // Back to the first page whenever the filters change: an offset into another
  // population is an offset into nothing.
  useEffect(() => {
    setPage((p) => ({ ...p, offset: 0 }));
  }, [settled, metric]);

  const filter = (partial: Partial<DoraQuery>) => setQuery((q) => ({ ...q, ...partial }));

  const backTo = `/dora/${slug}?${toSearchParams(query)}`;
  const result = report?.live.results.find((r) => r.metric === metric) ?? null;
  const shown = events?.items ?? [];

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
        </div>
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? t('common.refreshing') : `↻ ${t('common.refresh')}`}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {/* The list's own bar, controls and order included: the scope a reading
          was taken over is stated the same way wherever it is read. */}
      <div className="filters-row">
        <PeriodFilter
          value={{ from: query.from, to: query.to, windowDays: query.windowDays }}
          effective={report?.live.period}
          onChange={(next) => filter(next)}
          disabled={loading}
        />
        {report && (
          <DimensionFilter
            vocabulary={report.live.dimensions}
            value={query.dimensions ?? {}}
            onChange={(dimensions) => filter({ dimensions })}
            disabled={loading}
          />
        )}
      </div>

      {result && (
        <section className="panel">
          <div className="metric-current">
            <span className="dora-value">{formatValue(result)}</span>
            <span className="muted">{t('dora.sample', { count: result.sampleSize })}</span>
            {/* A reading over several combinations is not about any one of
                them. Left unsaid, the value looks wrong against a list that
                shows a handful of rows from across the lot. */}
            {(result.combinations ?? 1) > 1 && (
              <span className="muted">
                · {t('dora.detail.folded', { count: result.combinations })}
              </span>
            )}
          </div>
          <MetricTrend series={report!.series} unit={result.unit} metric={metric as DoraMetric} />
        </section>
      )}

      {result && (
        <section className="panel">
          <div className="panel-head">
            <h3>{t('dora.detail.title')}</h3>
            {/* The whole population is reachable now, so the count is a page
                of a total rather than a warning about what is missing. */}
            <span className="muted">
              {t('dora.detail.shown', { shown: shown.length, total: events?.page.total ?? 0 })}
            </span>
          </div>
          <SampleTable samples={shown} isDuration={result.unit === 'seconds'} />
          {events && (
            <Pagination info={events.page} value={page} onChange={setPage} disabled={loading} />
          )}
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
    <DataList
      rows={samples.map((sample, i) => ({ ...sample, key: String(i) }))}
      rowKey={(sample) => sample.key}
      columns={[
        {
          key: 'item',
          header: t('dora.detail.cols.item'),
          role: 'lead',
          className: 'mono',
          cell: (sample) => (
            <>
              {sample.url ? (
                <a href={sample.url} target="_blank" rel="noreferrer">
                  {sample.label}
                </a>
              ) : (
                sample.label
              )}
              {sample.details && <SampleDetails details={sample.details} />}
            </>
          ),
        },
        {
          key: 'date',
          header: t('dora.detail.cols.date'),
          cell: (sample) => formatDate(sample.at),
        },
        isDuration
          ? {
              key: 'duration',
              header: t('dora.detail.cols.duration'),
              className: 'num',
              cell: (sample) => (sample.value === null ? '—' : humanizeDuration(sample.value)),
            }
          : {
              key: 'status',
              header: t('dashboard.cols.status'),
              role: 'aside',
              cell: (sample) => <SampleStatus status={sample.status} />,
            },
      ]}
    />
  );
}
