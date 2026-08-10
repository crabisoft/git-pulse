import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { DoraReport, DoraMetric, MetricSeries } from '@repo/shared';
import { api, type DoraQuery } from '../api';
import { formatValue } from '../doraFormat';
import { toSearchParams } from '../doraQuery';
import { useCancellableLoad } from '../hooks';
import { doraCodec, useUrlQuery } from '../urlQuery';
import { HelpTip } from '../HelpTip';
import { DimensionFilter, PeriodFilter } from '../Filters';
import { Sparkline } from '../Sparkline';

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
 * One block per metric, over whatever the filters ask for.
 *
 * The blocks used to break down by dimension combination — a row for
 * `{type: prod, client: acme}`, another for `{type: prod, client: globex}` —
 * which turned the page into a cross product nobody read past the first screen
 * of. The filter bar does that job now: narrow it and the blocks answer about
 * the narrowed scope. Opening one carries the filters along, so the detail
 * describes the same number the block did.
 */
export function DoraPage({ sourceId, slug }: { sourceId: string; slug: string }) {
  const { t } = useTranslation();
  const [report, setReport] = useState<DoraReport | null>(null);
  const [history, setHistory] = useState<MetricSeries[]>([]);
  // The filters live in the address: they survive a back, and a link carries
  // them to whoever it is sent to. Debounced on the way there, so a burst of
  // clicks is one request and one history entry.
  const { query, setQuery, settled } = useUrlQuery(doraCodec);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [live, hist] = await Promise.all([
        api.dora(sourceId, settled, signal),
        // The same period and the same slice as the values beside them, folded
        // server-side: a sparkline is a second reading of the window the card
        // reports on, not of whatever happens to be in the snapshot table.
        api.metricSeries(
          sourceId,
          {
            metrics: METRIC_ORDER,
            dimensions: settled.dimensions,
            from: settled.from,
            to: settled.to,
            windowDays: settled.windowDays,
          },
          signal,
        ),
      ]);
      setReport(live);
      setHistory(hist);
    },
    [sourceId, settled],
  );
  const { reload, loading, error } = useCancellableLoad(load);

  const filter = (partial: Partial<DoraQuery>) => setQuery((q) => ({ ...q, ...partial }));

  const results = report?.results ?? null;
  /** What every block opens: the filters in effect, unaltered. */
  const search = toSearchParams(settled).toString();

  // Already folded and bucketed by day server-side, by the same code the metric
  // page's chart reads. Folding here instead meant appending the raw snapshots
  // of every matching combination end to end: three combinations gave three
  // values for one day, drawn as three moments of a line that never moved.
  const historyByMetric = new Map<string, number[]>(
    history.map((series) => [series.metric, series.points.map((point) => point.value)]),
  );

  return (
    <div>
      <div className="page-head">
        <h2>{t('dora.title')}</h2>
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? t('common.refreshing') : `↻ ${t('common.refresh')}`}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {/* A window read short produces perfectly ordinary-looking figures over a
          period nobody asked for, so it is said here rather than left in a log:
          this is the one caveat a reader cannot infer from the numbers. */}
      {report && report.truncated.length > 0 && (
        <div className="banner warn">
          {t('dora.truncated', {
            count: report.truncated.length,
            repos: [...new Set(report.truncated.map((read) => read.repo))].join(', '),
          })}
        </div>
      )}

      {/* Every filter in one left-aligned bar: period, scope, then slice. */}
      <div className="filters-row">
        <PeriodFilter
          value={{ from: query.from, to: query.to, windowDays: query.windowDays }}
          effective={report?.period}
          onChange={(next) => filter(next)}
          disabled={loading}
        />
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
            // A metric nothing was computed for has no block at all: the
            // filters narrow what is visible as well as what each block says.
            const result = results.find((r) => r.metric === metric);
            if (!result) return null;
            return (
              // The card is not itself the anchor: the help button lives in
              // it, and a button inside a link is both invalid and unclickable
              // — every press would navigate instead of opening the tip. The
              // link below covers the card from underneath instead.
              <section key={metric} className="panel metric-card">
                <h3 className="with-help">
                  {t(`dora.metric.${metric}`)}
                  <HelpTip text={t(`dora.help.${metric}`)} />
                </h3>
                <div className="metric-card-body">
                  <span className="dora-value">{formatValue(result)}</span>
                  <Sparkline values={historyByMetric.get(metric) ?? []} />
                  <Link
                    className="metric-card-link"
                    to={`/dora/${slug}/${metric}?${search}`}
                    aria-label={t('dora.detail.openMetric', {
                      metric: t(`dora.metric.${metric}`),
                    })}
                  >
                    <span className="dora-caret" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                </div>
                <span className="dora-sample">
                  {t('dora.sample', { count: result.sampleSize })}
                </span>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
