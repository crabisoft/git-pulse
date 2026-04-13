import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OverviewDirection, OverviewReport } from '@repo/shared';
import { api, type OverviewQuery } from '../api';
import { AUTO_REFRESH_MS, WALL_REFRESH_MS, useAutoRefresh, useCancellableLoad } from '../hooks';
import { overviewCodec, useUrlQuery, type OverviewState } from '../urlQuery';
import { WallEnter, WallExit } from '../overview/WallExit';
import { DimensionFilter, GroupByFilter, MetaFilter, PeriodFilter } from '../Filters';
import { RepoFilter } from '../RepoFilter';
import { humanizeDuration } from '../doraFormat';
import { defaultGroupBy } from '../overview/grouping';
import { DetailPanels } from '../overview/DetailPanels';
import { DirectionSwitch } from '../DirectionSwitch';
import { BoardView } from '../overview/BoardView';
import { InstrumentView } from '../overview/InstrumentView';
import { StreamView } from '../overview/StreamView';
import { VersionsView } from '../overview/VersionsView';
import { VersionTimeline } from '../overview/VersionTimeline';
import {
  DEFAULT_VERSION_AXES,
  defaultAxes,
  resolveAxes,
  versionAxisKeys,
} from '../overview/axes';

/**
 * What is running, how fast it is going out, and what is in the way — read
 * from across the room.
 *
 * Everything comes from one request: the board, the metrics and the health of
 * the collection describe the same instant, which five separate calls could
 * not promise. The detail lists that used to be this page load only when
 * somebody opens them.
 */
export function OverviewPage({
  sourceId,
  slug,
  staleHours,
  direction,
  onDirectionChange,
}: {
  sourceId: string;
  slug: string;
  staleHours: number | null;
  /** Which reading of the dashboard is on show, resolved by the shell. */
  direction: OverviewDirection;
  onDirectionChange: (next: OverviewDirection) => void;
}) {
  const { t } = useTranslation();
  const [report, setReport] = useState<OverviewReport | null>(null);
  // What is being looked at lives in the address — the filters, the fold and
  // the crossing alike. It survives a back, and a link carries the whole thing
  // to whoever it is sent to.
  const { query, setQuery, settled } = useUrlQuery(overviewCodec);

  // Keyed on the filters alone: the fold and the crossing rearrange what is
  // already loaded, and reloading for them would spend connector calls to
  // redraw the same data.
  const load = useCallback(
    async (signal: AbortSignal) => setReport(await api.overview(sourceId, settled.filters, signal)),
    [sourceId, settled.filters],
  );
  const { reload, loading, error } = useCancellableLoad(load);
  const wall = Boolean(query.wall);
  useAutoRefresh(reload, wall ? WALL_REFRESH_MS : AUTO_REFRESH_MS);

  /** Narrows what is reported — a new load. */
  const filter = (partial: Partial<OverviewQuery>) =>
    setQuery((q) => ({ ...q, filters: { ...q.filters, ...partial } }));
  /** Rearranges what is already there — no load. */
  const layout = (partial: Pick<OverviewState, 'groupBy' | 'axes'>) =>
    setQuery((q) => ({ ...q, ...partial }));
  const selectedRepos = useMemo(() => new Set(query.filters.repos), [query.filters.repos]);
  /**
   * Whether anything is narrowing the report. The period is left out on
   * purpose: it is always set, so counting it would make every page "filtered"
   * and the distinction it is drawn for — an empty view because of a choice, or
   * because there is nothing — would say nothing.
   */
  const narrowing =
    (query.filters.repos?.length ?? 0) > 0 ||
    Object.keys(query.filters.dimensions ?? {}).length > 0 ||
    Boolean(query.filters.meta);

  const dimensions = report?.dimensions ?? {};
  const environments = report?.environments ?? [];
  /** Nobody has chosen yet: the board proposes a fold, the matrix a crossing. */
  const fold =
    query.groupBy === undefined
      ? defaultGroupBy(dimensions, environments.length)
      : query.groupBy || null;
  /**
   * The crossing in force, resolved against what *this* direction can cross.
   *
   * One pair travels in the address and the two grids do not take the same
   * keys: `repo` crosses the versions and means nothing to the matrix. A pair
   * the current direction cannot honour falls back to that direction's own
   * default rather than rendering an empty grid, which is what makes walking
   * matrix → versions → matrix safe. The address keeps what it held: it still
   * belongs to the direction that wrote it.
   */
  const crossing =
    direction === 'versions'
      ? resolveAxes(query.axes, versionAxisKeys(dimensions), DEFAULT_VERSION_AXES)
      : resolveAxes(query.axes, Object.keys(dimensions), defaultAxes(dimensions));

  /**
   * Moves one axis of the crossing. Shared by both grids because the rule is:
   * crossing a key with itself says nothing, so the *other* axis steps aside
   * rather than the choice being refused.
   */
  const changeAxes = (next: { rows?: string; columns?: string }, available: string[]) => {
    if (!crossing) return;
    const rows = next.rows ?? crossing.rows;
    const columns =
      next.columns ??
      (rows === crossing.columns
        ? (available.find((key) => key !== rows) ?? crossing.columns)
        : crossing.columns);
    layout({ axes: { rows, columns } });
  };

  return (
    <div className="overview">
      <div className="page-head">
        <h2>{t('overview.title')}</h2>
        {report && <Freshness health={report.health} />}
        {/* Nothing to operate on a wall: no switch, no Refresh nobody will
            press, no filter bar. The address states the scope, and the only
            control left is the way back out of it. */}
        {wall ? (
          <WallExit />
        ) : (
          <>
            <DirectionSwitch direction={direction} onChange={onDirectionChange} />
            <button className="btn" onClick={reload} disabled={loading}>
              {loading ? t('common.refreshing') : `↻ ${t('common.refresh')}`}
            </button>
            <WallEnter />
          </>
        )}
      </div>

      {error && <div className="banner error">{error}</div>}

      {!wall && (
      <div className="filters-row">
        <PeriodFilter
          value={{ from: query.filters.from, to: query.filters.to, windowDays: query.filters.windowDays }}
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
        <DimensionFilter
          vocabulary={dimensions}
          value={query.filters.dimensions ?? {}}
          onChange={(next) => filter({ dimensions: next })}
          disabled={loading}
        />
        <MetaFilter
          options={report?.metaEnvironments ?? []}
          value={query.filters.meta ?? ''}
          onChange={(meta) => filter({ meta })}
          disabled={loading}
        />
        {/* The fold rearranges a list of environments. The matrix crosses two
            dimensions of its own, and the version grid is already a repo per
            row — neither has a list to fold. */}
        {direction !== 'instrument' && direction !== 'versions' && (
          <GroupByFilter
            keys={Object.keys(dimensions)}
            value={fold}
            onChange={(next) => layout({ groupBy: next ?? '' })}
            disabled={loading}
          />
        )}
      </div>
      )}

      {report && report.warnings.length > 0 && (
        <div className="banner warn">
          {report.warnings.map((w, i) => (
            <div key={i}>⚠ {t(w.code, w.params)}</div>
          ))}
        </div>
      )}

      {report && (
        <>
          {direction === 'instrument' ? (
            <InstrumentView
              report={report}
              axes={crossing}
              onAxesChange={(next) => changeAxes(next, Object.keys(dimensions))}
              staleHours={staleHours}
            />
          ) : direction === 'stream' ? (
            <StreamView report={report} sourceId={sourceId} query={settled.filters} />
          ) : direction === 'versions' ? (
            <VersionsView
              report={report}
              slug={slug}
              // Never null for this direction: its default is a constant pair
              // every reading carries, so there is always a grid to draw.
              axes={crossing ?? DEFAULT_VERSION_AXES}
              onAxesChange={(next) => changeAxes(next, versionAxisKeys(dimensions))}
              filtered={narrowing}
              onClearFilters={() => filter({ repos: [], dimensions: {}, meta: '' })}
              // Rearranges nothing and narrows nothing: it opens a dialog, and
              // it travels in the address so the timeline can be sent to
              // somebody. Hence `setQuery` rather than `filter` or `layout`.
              onOpenHistory={(history) => setQuery((current) => ({ ...current, history }))}
            />
          ) : (
            <BoardView report={report} fold={fold} slug={slug} staleHours={staleHours} />
          )}

          {/* Mounted only while a pair is open — nothing is read before the
              cell is clicked, and closing it drops the request with it. */}
          {query.history && (
            <VersionTimeline
              sourceId={sourceId}
              slug={slug}
              repo={query.history.repo}
              environment={query.history.environment}
              onClose={() =>
                setQuery(({ history: _closed, ...rest }) => rest)
              }
            />
          )}

          {/* Folded lists are a thing to click; there is nobody to click. */}
          {!wall && (
            <DetailPanels
              sourceId={sourceId}
              repos={query.filters.repos ?? []}
              staleHours={staleHours}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * How old what is on screen is. A stored source dates from its last
 * synchronisation; a live one is of the moment and has nothing to date.
 */
function Freshness({ health }: { health: OverviewReport['health'] }) {
  const { t } = useTranslation();
  return (
    <span className="freshness">
      {health.syncedAt && (
        <span className={`chip${health.staleForSec !== null && health.staleForSec > 3600 ? ' late' : ''}`}>
          {/* Floored at a second: a collection that just finished still has an
              age, and "—" where a duration belongs reads as a missing value. */}
          {t('overview.health.synced', { ago: humanizeDuration(Math.max(1, health.staleForSec ?? 1)) })}
        </span>
      )}
      {health.queues && (
        <span className={`chip${health.queues === 'ok' ? '' : ' late'}`}>
          {t(`overview.health.queues.${health.queues}`)}
        </span>
      )}
      {health.quotaLeft !== null && (
        <span className={`chip${health.quotaLeft < 0.2 ? ' late' : ''}`}>
          {t('overview.health.quota', { percent: Math.round(health.quotaLeft * 100) })}
        </span>
      )}
    </span>
  );
}
