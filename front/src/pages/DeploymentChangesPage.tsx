import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import type { DeploymentBase, DeploymentChanges } from '@repo/shared';
import { api } from '../api';
import { useCancellableLoad } from '../hooks';
import { PlatformLink } from '../PlatformLink';
import { RefLink } from '../RefLink';
import { CommitList } from '../CommitList';
import { CopyButton } from '../CopyButton';
import { FilterField } from '../Filters';
import { RefDialog } from './RefDialog';

/**
 * The commits a deployment carried, at a URL of its own.
 *
 * A sub-page rather than a dialog because this is the thing people send each
 * other — "look at what went out" is a link, and a link has to survive a
 * refresh and open without the list that produced it. Everything it needs is
 * therefore in the URL, and the payload carries the deployment itself so one
 * request draws the whole page.
 *
 * The period travels too: the base is looked for among the deployments of that
 * window, so a link reproduces exactly what its sender was reading.
 */
export function DeploymentChangesPage({ sourceId, slug }: { sourceId: string; slug: string }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [changes, setChanges] = useState<DeploymentChanges | null>(null);
  /** Open while the reader is choosing a ref; nothing is fetched until applied. */
  const [picking, setPicking] = useState(false);

  const id = params.get('id');
  const repo = params.get('repo');
  const customRef = params.get('ref') ?? '';
  // A `ref` base without a ref would ask the API for a comparison it will
  // refuse, so it reads as the default choice until one is picked.
  const asked = params.get('base');
  const base: DeploymentBase =
    asked === 'default' ? 'default' : asked === 'ref' && customRef ? 'ref' : 'previous';
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const windowDays = params.get('windowDays') ?? undefined;

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!id || !repo) return;
      setChanges(
        await api.deploymentChanges(
          sourceId,
          id,
          {
            repo,
            base,
            ref: base === 'ref' ? customRef : undefined,
            from,
            to,
            windowDays: windowDays ? Number(windowDays) : undefined,
          },
          signal,
        ),
      );
    },
    [sourceId, id, repo, base, customRef, from, to, windowDays],
  );
  const { loading, error } = useCancellableLoad(load);

  /** The list keeps its own filters, so going back there is a plain link. */
  const backTo = `/deployments/${slug}`;

  // Reached without what it is about — a hand-edited link, or the source picker
  // rewriting the path and dropping the query with it.
  if (!id || !repo) return <Navigate to={backTo} replace />;

  /** Switching base is a navigation, so the choice is in the link people send. */
  const chooseBase = (next: DeploymentBase, ref?: string) => {
    const updated = new URLSearchParams(params);
    updated.set('base', next);
    if (next === 'ref' && ref) updated.set('ref', ref);
    else updated.delete('ref');
    setParams(updated, { replace: true });
  };

  const deployment = changes?.deployment;

  return (
    <div>
      <div className="page-head">
        <div>
          <Link className="back-link" to={backTo}>
            ← {t('deployments.backToList')}
          </Link>
          <h2>
            {repo}
            {deployment && (
              <>
                {' → '}
                <PlatformLink
                  url={deployment.environmentUrl}
                  title={t('deployments.openEnvironment')}
                >
                  {deployment.environment}
                </PlatformLink>
              </>
            )}
          </h2>
        </div>
      </div>

      {deployment && (
        <p className="muted">
          {t('deployments.deployedRef')}{' '}
          <RefLink name={deployment.ref} url={deployment.refUrl} /> ·{' '}
          <PlatformLink url={deployment.url} title={t('deployments.openDeployment')}>
            {new Date(deployment.createdAt).toLocaleString()}
          </PlatformLink>{' '}
          ·{' '}
          <span className={`pill status-${deployment.status}`}>
            {t(`status.${deployment.status}`, deployment.status)}
          </span>
        </p>
      )}

      <div className="filters-row">
        <FilterField label={t('deployments.comparedTo')}>
          <select
            // The dialog owns the selection while it is open, so cancelling it
            // snaps back to the base still in effect.
            value={picking ? 'ref' : base}
            disabled={loading}
            onChange={(e) => {
              const next = e.target.value as DeploymentBase;
              if (next === 'ref') setPicking(true);
              else chooseBase(next);
            }}
          >
            <option value="previous">{t('deployments.basePrevious')}</option>
            <option value="default">{t('deployments.baseDefault')}</option>
            <option value="ref">{t('deployments.baseRef')}</option>
          </select>
        </FilterField>
        {base === 'ref' && (
          // Reads the pinned ref back, and reopens the dialog on it — the same
          // shape the custom period uses.
          <button type="button" className="btn" disabled={loading} onClick={() => setPicking(true)}>
            {customRef}
          </button>
        )}
      </div>

      {error && <div className="banner error">{error}</div>}
      {loading && <p className="muted">{t('common.loading')}</p>}
      {!loading && changes && <Changes changes={changes} />}

      {picking && (
        <RefDialog
          sourceId={sourceId}
          repo={repo}
          value={customRef}
          onApply={(ref) => {
            setPicking(false);
            chooseBase('ref', ref);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function Changes({ changes }: { changes: DeploymentChanges }) {
  const { t } = useTranslation();

  // No base at all is a fact about the data: the first deployment to an
  // environment genuinely has nothing before it to compare against.
  if (changes.baseRef === null) {
    return <p className="muted">{t('deployments.noBase')}</p>;
  }

  return (
    <>
      <p className="muted">
        {t('deployments.against')}{' '}
        <RefLink name={changes.baseRef} url={changes.baseRefUrl} />
        {/* Said rather than shown silently: this comparison was made when the
            refs still existed, and nothing here could make it again today. */}
        {changes.archivedAt && (
          <>
            {' · '}
            <span className="pill">
              {t('changelogs.archivedAt', {
                when: new Date(changes.archivedAt).toLocaleString(),
              })}
            </span>
          </>
        )}
      </p>
      {changes.entries.length === 0 ? (
        <p className="muted">{t('deployments.noChange')}</p>
      ) : (
        <>
          <div className="panel-head">
            <p className="muted">
              {t('deployments.summary', {
                count: changes.entries.length,
                authors: changes.authors,
              })}
            </p>
            <CopyButton text={changes.markdown} />
          </div>
          <CommitList entries={changes.entries} />
        </>
      )}
    </>
  );
}
