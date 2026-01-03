import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ClassifiedDeployment, DeploymentReport } from '@repo/shared';
import { api, type DeploymentsQuery, type PageQuery } from '../api';
import { FILTER_DEBOUNCE_MS, useCancellableLoad, useDebounced } from '../hooks';
import { ChoiceFilter, DimensionFilter, PeriodFilter } from '../Filters';
import { RepoFilter } from '../RepoFilter';
import { Pagination } from '../Pagination';
import { PlatformLink } from '../PlatformLink';
import { RefLink } from '../RefLink';

/**
 * Module constant so resetting on a source change never re-triggers a fetch.
 * Empty everywhere means: rolling window from the settings, every repo, no slice.
 */
const EMPTY_QUERY: DeploymentsQuery = {
  repos: [],
  environments: [],
  statuses: [],
  dimensions: {},
};

export function DeploymentsPage({ sourceId, slug }: { sourceId: string; slug: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState<DeploymentsQuery>(EMPTY_QUERY);
  const [report, setReport] = useState<DeploymentReport | null>(null);

  /**
   * Every filter change is a full round of connector calls on a live source, so
   * a burst of clicks becomes one request once it settles — the same safeguard
   * the dashboard and DORA use.
   */
  const settled = useDebounced(query, FILTER_DEBOUNCE_MS);

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

      {rows.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th>{t('deployments.when')}</th>
              <th>{t('deployments.repo')}</th>
              <th>{t('deployments.environment')}</th>
              <th>{t('deployments.ref')}</th>
              <th>{t('deployments.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((deployment) => (
              <tr key={deployment.id}>
                <td>
                  {/* The date is what identifies a deployment on this page, so
                      it is what carries the way back to it on the platform. */}
                  <PlatformLink url={deployment.url} title={t('deployments.openDeployment')}>
                    {new Date(deployment.createdAt).toLocaleString()}
                  </PlatformLink>
                </td>
                <td>{deployment.repo}</td>
                <td>
                  <PlatformLink
                    url={deployment.environmentUrl}
                    title={t('deployments.openEnvironment')}
                  >
                    {deployment.environment}
                  </PlatformLink>
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
                </td>
                <td>
                  <RefLink name={deployment.ref} url={deployment.refUrl} />
                </td>
                <td>
                  <span className={`pill status-${deployment.status}`}>
                    {t(`status.${deployment.status}`, deployment.status)}
                  </span>
                </td>
                <td>
                  <Link className="btn" to={changesLink(slug, deployment, query)}>
                    {t('deployments.contents')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
