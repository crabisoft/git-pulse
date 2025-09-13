import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  PAGE_LIMIT_MAX,
  type DoraPeriod,
  type DoraReport,
  type DoraResult,
  type DoraMetric,
  type DoraSample,
  type MetricSnapshotPublic,
} from '@repo/shared';
import { api, type DoraQuery, type PageQuery } from '../api';
import { windowLabel, windowOptions } from '../doraWindow';
import { FILTER_DEBOUNCE_MS, useCancellableLoad, useDebounced } from '../hooks';
import { HelpTip } from '../HelpTip';
import { Modal } from '../Modal';
import { Pagination } from '../Pagination';
import { RepoFilter } from '../RepoFilter';

const METRIC_ORDER: DoraMetric[] = [
  'deployment_frequency',
  'lead_time',
  'change_failure_rate',
  'mttr',
  'coding_time',
  'pickup_time',
  'review_time',
];

/**
 * Module constant so resetting on source change never re-triggers a fetch.
 * Empty everywhere means: rolling window from the settings, every repo, no slice.
 */
const EMPTY_QUERY: DoraQuery = { repos: [], dimensions: {} };

/** The period part of the query — a rolling window, or explicit bounds. */
type PeriodValue = Pick<DoraQuery, 'from' | 'to' | 'windowDays'>;

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

export function DoraPage({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const [report, setReport] = useState<DoraReport | null>(null);
  const [query, setQuery] = useState<DoraQuery>(EMPTY_QUERY);
  const [history, setHistory] = useState<MetricSnapshotPublic[]>([]);
  const [detail, setDetail] = useState<DoraResult | null>(null);

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
                    <button
                      key={i}
                      type="button"
                      className="dora-row"
                      onClick={() => setDetail(r)}
                      title={t('dora.detail.open')}
                      disabled={r.samples.length === 0}
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
                    </button>
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

      {detail && <DetailDialog result={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** Value of the option that opens the custom-period dialog. */
const CUSTOM = 'custom';

/** Bounds being edited, as the `YYYY-MM-DD` a date input speaks. Empty means open. */
type Bounds = { from: string; to: string };

/**
 * Reporting period: a rolling window picked from the presets, or explicit
 * bounds. Untouched, the dropdown shows the window resolved by the backend —
 * the one configured in the settings — so what you read is what you filter on.
 *
 * The bounds are edited in a dialog and applied in one go. Inline date inputs
 * would refetch on every keystroke the picker reports, and each fetch is a full
 * round of connector calls.
 */
function PeriodFilter({
  value,
  effective,
  onChange,
  disabled,
}: {
  value: PeriodValue;
  /** What the backend resolved, so the active period is never a mystery. */
  effective?: DoraPeriod;
  onChange: (next: PeriodValue) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const custom = Boolean(value.from || value.to);
  // Nothing chosen yet: the report tells which window is in effect.
  const windowDays = value.windowDays ?? effective?.windowDays ?? null;
  /** Draft bounds while the dialog is open; nothing is fetched until applied. */
  const [draft, setDraft] = useState<Bounds | null>(null);

  /** Starts from the period in effect rather than from two empty fields. */
  const edit = () =>
    setDraft({
      from: value.from ?? (effective ? day(effective.from) : ''),
      to: value.to ?? (effective ? day(effective.to) : ''),
    });

  const pick = (picked: string) => {
    if (picked === CUSTOM) edit();
    else onChange({ from: undefined, to: undefined, windowDays: Number(picked) });
  };

  const apply = (bounds: Bounds) => {
    setDraft(null);
    onChange({ from: bounds.from || undefined, to: bounds.to || undefined, windowDays: undefined });
  };

  return (
    <div className="period-filter">
      <label>
        {t('dora.period.window')}
        <select
          // The dialog owns the selection while it is open, so cancelling it
          // snaps the dropdown back to the window still in effect.
          value={custom || draft ? CUSTOM : (windowDays ?? '')}
          disabled={disabled}
          onChange={(e) => pick(e.target.value)}
        >
          {/* Placeholder until the first report says which window is in effect. */}
          {windowDays === null && !custom && <option value="" disabled />}
          {windowOptions(windowDays).map((days) => (
            <option key={days} value={days}>
              {windowLabel(t, days)}
            </option>
          ))}
          <option value={CUSTOM}>{t('dora.period.custom')}</option>
        </select>
      </label>
      {custom ? (
        <button type="button" className="btn" onClick={edit} disabled={disabled}>
          {boundsLabel(t, value.from, value.to)}
        </button>
      ) : (
        effective && (
          <span className="muted period-effective">
            {t('dora.period.effective', {
              from: formatDay(effective.from),
              to: formatDay(effective.to),
            })}
          </span>
        )
      )}
      <button
        type="button"
        className="btn"
        onClick={() => onChange({ from: undefined, to: undefined, windowDays: undefined })}
        disabled={disabled || (!custom && value.windowDays === undefined)}
        title={t('dora.period.resetHint')}
      >
        {t('dora.period.reset')}
      </button>

      {draft && <PeriodDialog value={draft} onApply={apply} onClose={() => setDraft(null)} />}
    </div>
  );
}

/** Edits both bounds, then applies them as a single change. */
function PeriodDialog({
  value,
  onApply,
  onClose,
}: {
  value: Bounds;
  onApply: (bounds: Bounds) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [bounds, setBounds] = useState(value);
  // An inverted period is rejected by the API; catching it here keeps a
  // half-typed date from costing a round trip.
  const inverted = Boolean(bounds.from && bounds.to && bounds.from > bounds.to);
  const valid = Boolean(bounds.from || bounds.to) && !inverted;

  const title = t('dora.period.dialogTitle');
  return (
    <Modal
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" type="submit" form="dora-period-form" disabled={!valid}>
            {t('dora.period.apply')}
          </button>
        </>
      }
    >
      <form
        id="dora-period-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onApply(bounds);
        }}
      >
        <p className="muted">{t('dora.period.dialogHint')}</p>
        <label>
          {t('dora.period.from')}
          <input
            type="date"
            value={bounds.from}
            max={bounds.to || undefined}
            autoFocus
            onChange={(e) => setBounds((b) => ({ ...b, from: e.target.value }))}
          />
        </label>
        <label>
          {t('dora.period.to')}
          <input
            type="date"
            value={bounds.to}
            min={bounds.from || undefined}
            onChange={(e) => setBounds((b) => ({ ...b, to: e.target.value }))}
          />
        </label>
      </form>
    </Modal>
  );
}

/** Reads the pinned period back, including the half-open cases. */
function boundsLabel(t: TFunction, from?: string, to?: string): string {
  if (from && to) return t('dora.period.effective', { from: formatDay(from), to: formatDay(to) });
  if (from) return t('dora.period.since', { from: formatDay(from) });
  return t('dora.period.until', { to: formatDay(to!) });
}

/**
 * One select per dimension key discovered in the results (customer, app, ...).
 * The vocabulary comes from the unsliced computation, so a narrowing choice
 * never removes the options you would need to widen back.
 */
function DimensionFilter({
  vocabulary,
  value,
  onChange,
  disabled,
}: {
  vocabulary: Record<string, string[]>;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const keys = Object.keys(vocabulary);
  if (keys.length === 0) return null;

  const pick = (key: string, picked: string) => {
    const next = { ...value };
    if (picked) next[key] = picked;
    else delete next[key];
    onChange(next);
  };

  return (
    <div className="dimension-filter">
      {keys.map((key) => (
        <label key={key}>
          {key}
          <select
            value={value[key] ?? ''}
            disabled={disabled}
            onChange={(e) => pick(key, e.target.value)}
          >
            <option value="">{t('dora.dimension.any')}</option>
            {vocabulary[key].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      ))}
      {Object.keys(value).length > 0 && (
        <button type="button" className="btn" onClick={() => onChange({})} disabled={disabled}>
          {t('dora.dimension.clear')}
        </button>
      )}
    </div>
  );
}

/**
 * A date with no time parses as UTC midnight, which reads as the day before
 * west of Greenwich — pin it to local midnight so a bound displays as typed.
 */
function formatDay(value: string): string {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  return new Date(at).toLocaleDateString(undefined, { dateStyle: 'short' });
}

/** ISO timestamp to the `YYYY-MM-DD` a date input expects. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/** Contributing events behind one metric value. */
function DetailDialog({ result, onClose }: { result: DoraResult; onClose: () => void }) {
  const { t } = useTranslation();
  const dimensions = Object.entries(result.dimensions);
  const isDuration = result.unit === 'seconds';

  return (
    <Modal
      label={t(`dora.metric.${result.metric}`)}
      onClose={onClose}
      title={
        <span className="with-help">
          {t(`dora.metric.${result.metric}`)}
          <HelpTip text={t(`dora.help.${result.metric}`)} />
        </span>
      }
      subtitle={
        <>
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
          <p className="muted modal-count">
            {t('dora.detail.shown', { shown: result.samples.length, total: result.sampleSize })}
          </p>
        </>
      }
    >
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
    </Modal>
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
