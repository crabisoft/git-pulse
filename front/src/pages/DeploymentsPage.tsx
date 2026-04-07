import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type {
  ClassifiedDeployment,
  DeploymentReport,
  DeploymentVersion,
  EnvironmentVersion,
} from '@repo/shared';
import { api, type DeploymentsQuery, type PageQuery } from '../api';
import { useCancellableLoad } from '../hooks';
import { agreesWithRef, newestPerEnvironment, readingAge } from '../versions';
import { DataList } from '../DataList';
import { deploymentsCodec, useUrlQuery } from '../urlQuery';
import { ChoiceFilter, DimensionFilter, PeriodFilter } from '../Filters';
import { RepoFilter } from '../RepoFilter';
import { Pagination } from '../Pagination';
import { PlatformLink } from '../PlatformLink';
import { RefLink } from '../RefLink';

export function DeploymentsPage({ sourceId, slug }: { sourceId: string; slug: string }) {
  const { t } = useTranslation();
  const [report, setReport] = useState<DeploymentReport | null>(null);
  /**
   * The filters live in the address, so a back walks them and a link carries
   * them. Debounced on the way there: every change is a full round of
   * connector calls on a live source, so a burst of clicks becomes one request
   * and one history entry.
   */
  const { query, setQuery, settled } = useUrlQuery(deploymentsCodec);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setReport(await api.deployments(sourceId, settled, signal));
    },
    [sourceId, settled],
  );
  const { loading, error, reload } = useCancellableLoad(load);

  /** Any change to the filters starts the page over — a window is not a page. */
  const filter = (patch: Partial<DeploymentsQuery>) =>
    setQuery((current) => ({ ...current, ...patch, offset: 0 }));

  const selectedRepos = useMemo(() => new Set(query.repos ?? []), [query.repos]);
  const rows = report?.deployments.items ?? [];
  /** The reading frozen against each deployment — the strongest claim there is. */
  const frozen = useMemo(
    () => new Map((report?.versions ?? []).map((row) => [row.deploymentId, row])),
    [report?.versions],
  );
  /**
   * What each environment runs now, and which rows may say so.
   *
   * The fallback for everything deployed before the version rules existed: no
   * probe will ever reach those deployments, so without this the column is
   * blank for ever on all of the history. Confined to the newest deployment of
   * each pair, and never allowed to stand in for a frozen row — see the cell.
   */
  const current = useMemo(
    () =>
      new Map(
        (report?.currentVersions ?? []).map((row) => [pairKey(row.repo, row.environment), row]),
      ),
    [report?.currentVersions],
  );
  const newest = useMemo(() => newestPerEnvironment(rows), [rows]);
  /**
   * The column appears when the source **has version rules**, not when it has
   * readings. A source configured five minutes ago has rules and nothing read,
   * and that is exactly the moment somebody goes looking for the column to
   * find out why it shows nothing — hiding it then answers the question with
   * silence.
   */
  const showVersions = (report?.versionRules ?? 0) > 0;

  return (
    <div>
      <div className="page-head">
        <h2>{t('deployments.title')}</h2>
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? t('common.refreshing') : `↻ ${t('common.refresh')}`}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {/* One left-aligned bar, in the order a question narrows: when, where, what. */}
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
        {report && report.statuses.length > 1 && (
          <ChoiceFilter
            label={t('deployments.status')}
            anyLabel={t('deployments.anyStatus')}
            options={report.statuses}
            value={query.statuses ?? []}
            onChange={(statuses) => filter({ statuses: statuses as DeploymentsQuery['statuses'] })}
            disabled={loading}
            translateOption={(status) => t(`status.${status}`, status)}
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

      {report && rows.length === 0 && <p className="muted">{t('deployments.empty')}</p>}

      {/* Described once, rendered as a table on a wide screen and as cards on
          a phone — see DataList. The date leads a card because it is what
          identifies a deployment here, and it is what carries the way back to
          it on the platform. */}
      <DataList
        rows={rows}
        rowKey={(deployment) => deployment.id}
        columns={[
          {
            key: 'when',
            header: t('deployments.when'),
            role: 'lead',
            cell: (deployment) => (
              <PlatformLink url={deployment.url} title={t('deployments.openDeployment')}>
                {new Date(deployment.createdAt).toLocaleString()}
              </PlatformLink>
            ),
          },
          {
            key: 'repo',
            header: t('deployments.repo'),
            cell: (deployment) => deployment.repo,
          },
          {
            // The environment, and what a rule captured about the deployment
            // that went to it. One cell rather than two: the pills qualify the
            // environment, and a column of their own would have no header to
            // put over it.
            key: 'environment',
            header: t('deployments.environment'),
            cell: (deployment) => (
              <>
                <PlatformLink
                  url={deployment.environmentUrl}
                  title={t('deployments.openEnvironment')}
                >
                  {deployment.environment}
                </PlatformLink>
                {Object.keys(deployment.attributes).length + deployment.metaEnvironments.length >
                  0 && (
                  <div className="pills">
                    {Object.entries(deployment.attributes).map(([key, value]) => (
                      <span key={key} className="pill attr">
                        {key}={value}
                      </span>
                    ))}
                    {deployment.metaEnvironments.map((meta) => (
                      <span key={meta} className="pill meta">
                        {meta}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ),
          },
          {
            key: 'ref',
            header: t('deployments.ref'),
            cell: (deployment) => <RefLink name={deployment.ref} url={deployment.refUrl} />,
          },
          // Next to the deployed ref, because the two are one reading: what was
          // sent, and what answers. Apart they are two facts nobody compares.
          ...(showVersions
            ? [
                {
                  key: 'running',
                  header: t('versions.running'),
                  cell: (deployment: ClassifiedDeployment) => (
                    <DeployedVersion
                      deployment={deployment}
                      frozen={frozen.get(deployment.id)}
                      // Offered only where it could be true: the newest
                      // deployment of this environment in the list.
                      current={
                        newest.has(deployment.id)
                          ? current.get(pairKey(deployment.repo, deployment.environment))
                          : undefined
                      }
                    />
                  ),
                },
              ]
            : []),
          {
            key: 'status',
            header: t('deployments.status'),
            role: 'aside',
            cell: (deployment) => (
              <span className={`pill status-${deployment.status}`}>
                {t(`status.${deployment.status}`, deployment.status)}
              </span>
            ),
          },
          {
            key: 'contents',
            role: 'full',
            cell: (deployment) => (
              <Link className="btn" to={changesLink(slug, deployment, query)}>
                {t('deployments.contents')}
              </Link>
            ),
          },
        ]}
      />

      {report && (
        <Pagination
          info={report.deployments.page}
          value={{ limit: query.limit, offset: query.offset }}
          // Paging is not filtering: it must not reset the offset the way
          // `filter` does, so it writes the window straight through.
          onChange={(page: PageQuery) => setQuery((current) => ({ ...current, ...page }))}
          disabled={loading}
        />
      )}

    </div>
  );
}

/**
 * What this deployment's environment was answering while it was the live one,
 * frozen at the time — not what that environment runs today.
 *
 * Three outcomes, and they are three different facts:
 *
 * - **frozen version** — the environment answered, and the value is what it
 *   said. Compared against the deployed ref: agreeing needs no comment,
 *   differing is the reason this feature exists, and a ref that states no
 *   release (a branch, a sha) is left plain rather than flagged either way;
 * - **frozen failure** — a reading was taken and brought nothing back. Worth
 *   keeping: "we asked and got nothing" is actionable in a way a blank is not;
 * - **never read** — no probe reached this deployment while it was live. Said
 *   with a word rather than a dash, because it is **not** a gap waiting to be
 *   filled: asking the environment now answers about whatever is running now,
 *   so this row will never have a version. Unlike the changelog archive, which
 *   can be filed hours late, a version reading has one moment to be taken.
 */
function DeployedVersion({
  deployment,
  frozen,
  current,
}: {
  deployment: ClassifiedDeployment;
  frozen: DeploymentVersion | undefined;
  /**
   * What the environment runs now, offered only on the newest deployment of
   * that environment. Never a substitute for a frozen row: it answers a
   * different question, and the difference between the two answers is the
   * whole point of reading versions at all.
   */
  current: EnvironmentVersion | undefined;
}) {
  const { t } = useTranslation();

  if (!frozen) {
    // Nothing was frozen against this deployment, and nothing ever will be.
    // What can honestly be said instead — and only about the deployment still
    // standing — is what the environment answers today.
    if (current?.version) return <CurrentVersion deployment={deployment} current={current} />;
    return (
      <span className="version-reading never" title={t('versions.neverReadHint')}>
        {t('versions.neverRead')}
      </span>
    );
  }

  const age = readingAge(frozen.observedAt);
  const when = t(`versions.age.${age.unit}`, { count: age.count });
  // How long after the deployment the reading was taken. A version confirmed
  // three seconds in says much less than one confirmed ten minutes in, and the
  // reader is the one who has to weigh that.
  const after = t('versions.readAfter', { delay: humanDelay(t, frozen.delaySec) });

  if (frozen.status !== 'ok' || !frozen.version) {
    return (
      <span
        className="version-reading failed"
        title={frozen.error ? t(frozen.error.code, frozen.error.params) : undefined}
      >
        {t(`versions.status.${frozen.status}`)} <span className="muted">· {when}</span>
      </span>
    );
  }

  const agreement = agreesWithRef(frozen.version, deployment.ref);
  return (
    <span className={`version-reading confirmed ${agreement}`} title={after}>
      <span className="mono">{frozen.version}</span>{' '}
      {agreement === 'differs' && <span className="pill version-gap">{t('versions.differs')}</span>}
      <span className="muted"> · {when}</span>
    </span>
  );
}

/**
 * What the environment is running **now**, on the row of the deployment still
 * standing there.
 *
 * A weaker claim than a frozen reading, and it has to look and read like one.
 * "This deployment put 1.4.2 live" and "1.4.2 is what answers there today" are
 * different statements: the second is true of the environment, not of the
 * deployment, and something outside this application may well be the reason for
 * it. A reader who took one for the other would draw exactly the wrong
 * conclusion from a mismatch — which is the conclusion this whole feature
 * exists to support.
 *
 * So: its own tone, its own word on the row, and the comparison with the ref
 * left in place — a current version that disagrees with the ref deployed here
 * is still worth seeing, it just means something about the environment rather
 * than about this deployment.
 */
function CurrentVersion({
  deployment,
  current,
}: {
  deployment: ClassifiedDeployment;
  current: EnvironmentVersion;
}) {
  const { t } = useTranslation();
  const age = readingAge(current.observedAt);
  const when = t(`versions.age.${age.unit}`, { count: age.count });
  const agreement = agreesWithRef(current.version, deployment.ref);

  return (
    <span className={`version-reading live ${agreement}`} title={t('versions.currentHint')}>
      <span className="mono">{current.version}</span>{' '}
      <span className="pill version-live">{t('versions.current')}</span>
      {agreement === 'differs' && <span className="pill version-gap">{t('versions.differs')}</span>}
      <span className="muted"> · {when}</span>
    </span>
  );
}

/** Joined on NUL, which neither a repo nor an environment name carries. */
function pairKey(repo: string, environment: string): string {
  return `${repo}\u0000${environment}`;
}

/** The delay between a deployment and its reading, in the page's own units. */
function humanDelay(
  t: (key: string, params?: Record<string, unknown>) => string,
  seconds: number,
): string {
  if (seconds < 60) return t('versions.delay.second', { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('versions.delay.minute', { count: minutes });
  return t('versions.delay.hour', { count: Math.round(minutes / 60) });
}

/**
 * The link to a deployment's contents. The period travels with it because the
 * base is looked for among the deployments of that window — a link that dropped
 * it would answer about a different stretch of time than the list it came from.
 */
function changesLink(
  slug: string,
  deployment: ClassifiedDeployment,
  query: DeploymentsQuery,
): string {
  const params = new URLSearchParams({ id: deployment.id, repo: deployment.repo });
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.windowDays !== undefined) params.set('windowDays', String(query.windowDays));
  return `/deployments/${slug}/changes?${params}`;
}
