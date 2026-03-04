import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  PAGE_LIMIT_MAX,
  type DoraReport,
  type DoraMetric,
  type MetricSnapshotPublic,
} from '@repo/shared';
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
  const [history, setHistory] = useState<MetricSnapshotPublic[]>([]);
  // The filters live in the address: they survive a back, and a link carries
  // them to whoever it is sent to. Debounced on the way there, so a burst of
  // clicks is one request and one history entry.
  const { query, setQuery, settled } = useUrlQuery(doraCodec);
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

  const filter = (partial: Partial<DoraQuery>) => setQuery((q) => ({ ...q, ...partial }));

  const results = report?.results ?? null;
  /** What every block opens: the filters in effect, unaltered. */
  const search = toSearchParams(settled).toString();

  // The sparkline history is folded like the report is — every snapshot whose
  // combination satisfies the filter feeds the metric's line, rather than only
  // the one stored against that exact combination.
  const historyByMetric = new Map<string, number[]>();
  for (const snapshot of history) {
    if (!matchesFilter(snapshot.dimensions, settled.dimensions ?? {})) continue;
    const bucket = historyByMetric.get(snapshot.metric);
    if (bucket) bucket.push(snapshot.value);
    else historyByMetric.set(snapshot.metric, [snapshot.value]);
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

/** Every pair of the filter must be present for a snapshot to contribute. */
function matchesFilter(
  dimensions: Record<string, string>,
  filter: Record<string, string>,
): boolean {
  return Object.entries(filter).every(([key, value]) => dimensions[key] === value);
}
