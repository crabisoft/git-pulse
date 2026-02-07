import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ClassifiedDeployment, DeploymentReport } from '@repo/shared';
import { api, type DeploymentsQuery, type PageQuery } from '../api';
import { useCancellableLoad } from '../hooks';
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
