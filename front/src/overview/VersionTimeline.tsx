import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { PageInfo, VersionChangeEntry, VersionHistory } from '@repo/shared';
import { api, type PageQuery } from '../api';
import { useCancellableLoad } from '../hooks';
import { humanizeDuration } from '../doraFormat';
import { Modal } from '../Modal';
import { Pagination } from '../Pagination';

/** Module constant, so re-rendering the dialog never re-triggers the fetch. */
const FIRST_PAGE: PageQuery = {};

/**
 * Every version one environment has run, newest first.
 *
 * Read from the cell that raised the question — one is looking at a version and
 * wants to know since when, and what was there before. Mounted only when a pair
 * is open, which is what keeps a grid of forty cells from being forty requests
 * nobody asked for.
 *
 * A dialog rather than an inline panel: it is a drill-down on one cell of a
 * grid that is itself the page, and pushing the grid aside to make room would
 * cost the reader the row they came from.
 */
export function VersionTimeline({
  sourceId,
  slug,
  repo,
  environment,
  onClose,
}: {
  sourceId: string;
  slug: string;
  repo: string;
  environment: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<VersionHistory | null>(null);
  const [page, setPage] = useState<PageQuery>(FIRST_PAGE);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setHistory(await api.versionHistory(sourceId, { repo, environment }, page, signal));
    },
    [sourceId, repo, environment, page],
  );
  const { loading, error } = useCancellableLoad(load);

  const title = t('versions.history.title', { repo, environment });
  const entries = history?.changes.items ?? [];

  return (
    <Modal title={title} label={title} onClose={onClose}>
      {error && <div className="banner error">{error}</div>}
      {loading && entries.length === 0 && <p className="muted">{t('common.loading')}</p>}

      {history && entries.length === 0 && !loading && (
        <p className="muted empty-note">{t('versions.history.empty')}</p>
      )}

      {entries.length > 0 && (
        <ol className="version-timeline">
          {entries.map((entry) => (
            <Entry key={`${entry.version}-${entry.observedAt}`} entry={entry} slug={slug} repo={repo} />
          ))}
        </ol>
      )}

      {/* Where the record starts, said whatever page is on screen. A short
          timeline is not a quiet environment — it may be a rule written
          yesterday, and only this tells the two apart. */}
      {history?.firstSeenAt && (
        <p className="hint version-timeline-start">
          {t('versions.history.since', { at: new Date(history.firstSeenAt).toLocaleString() })}
        </p>
      )}

      {history && <TimelinePagination info={history.changes.page} value={page} onChange={setPage} />}
    </Modal>
  );
}

/** Only worth showing once there is a second page to go to. */
function TimelinePagination({
  info,
  value,
  onChange,
}: {
  info: PageInfo;
  value: PageQuery;
  onChange: (next: PageQuery) => void;
}) {
  if (info.total <= info.limit) return null;
  return <Pagination info={info} value={value} onChange={onChange} />;
}

/**
 * One version, and what is known about how it got there.
 *
 * The distinction the whole timeline exists to draw: a change carrying a
 * deployment is the platform doing its job, and a change carrying none means
 * something moved the version that the platform knows nothing about — a
 * container restarted by hand on an older image, a rollback outside the
 * pipeline, a drift. That is not an edge case to be tolerated in the markup, it
 * is the reading somebody opened this for.
 */
function Entry({
  entry,
  slug,
  repo,
}: {
  entry: VersionChangeEntry;
  slug: string;
  repo: string;
}) {
  const { t } = useTranslation();
  const explained = entry.deploymentId !== null;
  const held = heldFor(entry);

  return (
    <li className={`version-entry${explained ? '' : ' unexplained'}`}>
      <div className="version-entry-head">
        <span className="mono version-entry-version">{entry.version}</span>
        {!entry.until && <span className="pill version-live">{t('versions.history.current')}</span>}
        {!explained && (
          <span className="pill version-gap" title={t('versions.history.unexplainedHint')}>
            {t('versions.history.unexplained')}
          </span>
        )}
      </div>
      <div className="version-entry-meta muted">
        {new Date(entry.observedAt).toLocaleString()}
        {held !== null && ` · ${t('versions.history.held', { duration: humanizeDuration(held) })}`}
      </div>
      {explained && (
        <div className="version-entry-meta">
          {/* Where the rest of the application links what it shows: the
              deployment that put this version here, with its own page. */}
          <Link
            to={`/deployments/${slug}/changes?id=${encodeURIComponent(entry.deploymentId as string)}&repo=${encodeURIComponent(repo)}`}
          >
            {t('versions.history.deployment', { ref: entry.ref ?? entry.deploymentId })}
          </Link>
        </div>
      )}
    </li>
  );
}

/**
 * How long a version held, in seconds, or null for the one still running.
 *
 * Null rather than "until now": a version that has not been replaced has no
 * duration yet, and counting one from the clock would make the top of every
 * timeline tick upwards for no reason.
 */
function heldFor(entry: VersionChangeEntry): number | null {
  if (!entry.until) return null;
  return Math.max(
    0,
    (new Date(entry.until).getTime() - new Date(entry.observedAt).getTime()) / 1000,
  );
}
