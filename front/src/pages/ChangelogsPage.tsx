import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangelogReport, DeploymentChangelog, DeploymentChangelogSummary } from '@repo/shared';
import { api, type ChangelogsQuery, type PageQuery } from '../api';
import { useCancellableLoad } from '../hooks';
import { changelogsCodec, useUrlQuery } from '../urlQuery';
import { ChoiceFilter, FilterField } from '../Filters';
import { RepoFilter } from '../RepoFilter';
import { Pagination } from '../Pagination';
import { PlatformLink } from '../PlatformLink';
import { RefLink } from '../RefLink';
import { DataList } from '../DataList';
import { CommitList } from '../CommitList';
import { CopyButton } from '../CopyButton';

/**
 * What deployments carried, months after the fact.
 *
 * The deployments page answers the same question about the recent window, by
 * asking the platform. This one answers it about everything ever filed, by
 * reading rows — which is the only way it can be answered at all once an
 * environment has been torn down and its branches deleted.
 */
export function ChangelogsPage({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  /**
   * The filters live in the address: an archive read is often a link somebody
   * was sent, and a back should land on the search it came from. Debounced on
   * the way there, so typing in the search box is neither a request nor a
   * history entry per keystroke.
   */
  const { query, setQuery, settled } = useUrlQuery(changelogsCodec);
  const [report, setReport] = useState<ChangelogReport | null>(null);
  /** The release being read, if any. One at a time: it is a long read, not a column. */
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setReport(await api.changelogs(sourceId, settled, signal));
    },
    [sourceId, settled],
  );
  const { loading, error, reload } = useCancellableLoad(load);

  /** Any change to the filters starts the page over — a window is not a page. */
  const filter = (patch: Partial<ChangelogsQuery>) => {
    setOpenId(null);
    setQuery((current) => ({ ...current, ...patch, offset: 0 }));
  };

  const selectedRepos = useMemo(() => new Set(query.repos ?? []), [query.repos]);
  const rows = report?.changelogs.items ?? [];

  return (
    <div>
      <div className="page-head">
        <h2>{t('changelogs.title')}</h2>
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? t('common.refreshing') : `↻ ${t('common.refresh')}`}
        </button>
      </div>

      <p className="muted subtabs-hint">{t('changelogs.hint')}</p>
      {error && <div className="banner error">{error}</div>}

      <div className="filters-row">
        {report && report.repos.length > 1 && (
          <RepoFilter
            repos={report.repos}
            selected={selectedRepos}
            onChange={(next) => filter({ repos: [...next].sort() })}
            disabled={loading}
          />
        )}
        {report && report.environments.length > 1 && (
          <ChoiceFilter
            label={t('deployments.environment')}
            anyLabel={t('deployments.anyEnvironment')}
            options={report.environments}
            value={query.environments ?? []}
            onChange={(environments) => filter({ environments })}
            disabled={loading}
          />
        )}
        <FilterField label={t('changelogs.since')}>
          <input
            type="date"
            value={query.from?.slice(0, 10) ?? ''}
            disabled={loading}
            onChange={(e) => filter({ from: e.target.value || undefined })}
          />
        </FilterField>
        <FilterField label={t('changelogs.until')}>
          <input
            type="date"
            value={query.to?.slice(0, 10) ?? ''}
            disabled={loading}
            onChange={(e) => filter({ to: e.target.value || undefined })}
          />
        </FilterField>
        <FilterField label={t('changelogs.search')} wide>
          <input
            type="search"
            value={query.search ?? ''}
            placeholder={t('changelogs.searchHint')}
            onChange={(e) => filter({ search: e.target.value })}
          />
        </FilterField>
      </div>

      {report && rows.length === 0 && (
        <p className="muted">
          {/* Two different emptinesses: nothing filed yet, and nothing matching.
              An install that has just been upgraded is in the first one, and
              telling it to widen its filters would send it looking for nothing. */}
          {report.lastArchivedAt === null ? t('changelogs.neverRun') : t('changelogs.empty')}
        </p>
      )}

      {rows.length > 0 && (
        <DataList
          rows={rows}
          rowKey={(log) => log.id}
          expanded={(log) =>
            openId === log.id ? <Contents sourceId={sourceId} log={log} /> : null
          }
          columns={[
            {
              key: 'when',
              header: t('deployments.when'),
              role: 'lead',
              cell: (log) => (
                <PlatformLink url={log.deploymentUrl} title={t('deployments.openDeployment')}>
                  {new Date(log.deployedAt).toLocaleString()}
                </PlatformLink>
              ),
            },
            { key: 'repo', header: t('deployments.repo'), cell: (log) => log.repo },
            {
              key: 'environment',
              header: t('deployments.environment'),
              cell: (log) => (
                <PlatformLink url={log.environmentUrl} title={t('deployments.openEnvironment')}>
                  {log.environment}
                </PlatformLink>
              ),
            },
            {
              key: 'ref',
              header: t('deployments.ref'),
              cell: (log) => (
                <>
                  <RefLink name={log.ref} url={log.refUrl} />
                  {log.baseRef && (
                    <div className="muted">
                      {t('deployments.against')} <RefLink name={log.baseRef} url={log.baseRefUrl} />
                    </div>
                  )}
                </>
              ),
            },
            {
              key: 'contents',
              header: t('changelogs.contents'),
              cell: (log) =>
                log.unreadable ? (
                  <span className="pill">{t('changelogs.unreadable')}</span>
                ) : (
                  t('deployments.summary', { count: log.commits, authors: log.authors })
                ),
            },
            {
              key: 'read',
              role: 'full',
              // Nothing to open on a record filed without contents: the button would
              // promise a read that has no text behind it.
              cell: (log) =>
                log.unreadable ? null : (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setOpenId(openId === log.id ? null : log.id)}
                  >
                    {openId === log.id ? t('changelogs.hide') : t('changelogs.read')}
                  </button>
                ),
            },
          ]}
        />
      )}

      {report && (
        <Pagination
          info={report.changelogs.page}
          value={{ limit: query.limit, offset: query.offset }}
          // Paging is not filtering: it writes the window straight through
          // rather than resetting the offset the way `filter` does.
          onChange={(page: PageQuery) => {
            setOpenId(null);
            setQuery((current) => ({ ...current, ...page }));
          }}
          disabled={loading}
        />
      )}

      {report?.lastArchivedAt && (
        <p className="muted">
          {t('changelogs.lastArchived', {
            when: new Date(report.lastArchivedAt).toLocaleString(),
          })}
        </p>
      )}
    </div>
  );
}

/**
 * One filed release, and its contents when they are asked for.
 *
 * The commits are fetched on opening rather than listed with the row: a page of
 * a hundred releases carries every commit message of each otherwise, which is
 * most of the payload and none of what the table shows.
 */
/**
 * What a deployment carried, fetched when it is opened and not before.
 *
 * A list of these is a page of requests nobody asked for: the summary on the
 * row is what most readers stop at, and the contents are what one of them
 * wanted. Kept as a component of its own so the fetch is scoped to the row
 * being read — closing it drops the state with it.
 */
function Contents({
  sourceId,
  log,
}: {
  sourceId: string;
  log: DeploymentChangelogSummary;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<DeploymentChangelog | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setDetail(await api.changelog(sourceId, log.deploymentId, signal));
    },
    [sourceId, log.deploymentId],
  );
  const { loading, error } = useCancellableLoad(load);

  return (
    <div className="changelog-contents">
      {error && <div className="banner error">{error}</div>}
      {loading && <p className="muted">{t('common.loading')}</p>}
      {detail && <ContentsBody log={detail} />}
    </div>
  );
}

/** What was filed: the commits, and the text that was rendered from them. */
function ContentsBody({ log }: { log: DeploymentChangelog }) {
  const { t } = useTranslation();

  // Both of these have no base and no entries, and they mean opposite things:
  // one carried everything, the other carried something nobody can name any
  // more. Read in that order — unreadable is the answer about the archive, and
  // "first deployment" would be a guess dressed as a fact.
  if (log.unreadable) return <p className="muted">{t('changelogs.unreadableHint')}</p>;
  if (log.baseRef === null) return <p className="muted">{t('changelogs.noBase')}</p>;
  if (log.entries.length === 0) return <p className="muted">{t('deployments.noChange')}</p>;

  return (
    <>
      <CommitList entries={log.entries} />
      <details className="markdown-source">
        <summary>
          {t('releaseNotes.markdown')}
          {' · '}
          {t(`releaseNotes.generator.${log.generator}`)}
        </summary>
        <div className="panel-head">
          <span className="muted">
            {t('changelogs.archivedAt', { when: new Date(log.archivedAt).toLocaleString() })}
          </span>
          <CopyButton text={log.markdown} />
        </div>
        <pre className="mono">{log.markdown}</pre>
      </details>
    </>
  );
}
