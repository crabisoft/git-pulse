import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DashboardEnvironment, DashboardLive, PipelineStatus } from '@repo/shared';
import { api, apiErrorInfo, type DashboardLiveQuery, type PageQuery } from '../api';
import { Pagination } from '../Pagination';

/** Used until the settings are loaded; the backend applies the stored value. */
const DEFAULT_STALE_HOURS = 72;

/** Module constant so resetting on source change never re-triggers a fetch. */
const EMPTY_QUERY: Required<DashboardLiveQuery> = {
  repos: [],
  prs: {},
  pipelines: {},
  environments: {},
};

export function DashboardPage({
  sourceId,
  staleHours,
}: {
  sourceId: string;
  staleHours: number | null;
}) {
  const stale = staleHours ?? DEFAULT_STALE_HOURS;
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardLive | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Repo filter and the three page windows are resolved by the backend, so the
  // tiles keep counting the whole filtered data set rather than the visible page.
  const [query, setQuery] = useState<Required<DashboardLiveQuery>>(EMPTY_QUERY);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.live(sourceId, query));
    } catch (e) {
      const { code, params } = apiErrorInfo(e);
      setError(t(code, params));
    } finally {
      setLoading(false);
    }
  }, [sourceId, query, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset the repo filter and the windows when switching source.
  useEffect(() => {
    setQuery(EMPTY_QUERY);
  }, [sourceId]);

  const selectedRepos = useMemo(() => new Set(query.repos), [query.repos]);

  /** A new repo selection invalidates every offset, but keeps the page sizes. */
  const changeRepos = (next: Set<string>) =>
    setQuery((q) => ({
      repos: [...next].sort(),
      prs: { ...q.prs, offset: 0 },
      pipelines: { ...q.pipelines, offset: 0 },
      environments: { ...q.environments, offset: 0 },
    }));

  const setWindow = (key: 'prs' | 'pipelines' | 'environments') => (page: PageQuery) =>
    setQuery((q) => ({ ...q, [key]: page }));

  const repos = data?.repos ?? [];
  const pullRequests = data?.pullRequests.items ?? [];
  const pipelines = data?.pipelines.items ?? [];
  const environments = data?.environments.items ?? [];
  const summary = data?.summary;

  return (
    <div>
      <div className="page-head">
        <h2>{t('dashboard.title')}</h2>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? t('common.refreshing') : `↻ ${t('common.refresh')}`}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {data && summary && (
        <>
          {repos.length > 1 && (
            <RepoFilter repos={repos} selected={selectedRepos} onChange={changeRepos} />
          )}

          <div className="tiles">
            <Tile label={t('dashboard.tiles.openPrs')} value={summary.openPrs} />
            <Tile label={t('dashboard.tiles.stalePrs')} value={summary.stalePrs} tone="warn" />
            <Tile
              label={t('dashboard.tiles.failedPipelines')}
              value={summary.failedPipelines}
              tone="crit"
            />
            <Tile
              label={t('dashboard.tiles.runningPipelines')}
              value={summary.runningPipelines}
              tone="accent"
            />
            <Tile label={t('dashboard.tiles.environments')} value={summary.environments} />
          </div>

          {data.warnings.length > 0 && (
            <div className="banner warn">
              {data.warnings.map((w, i) => (
                <div key={i}>⚠ {t(w.code, w.params)}</div>
              ))}
            </div>
          )}

          <section className="panel env-panel">
            <h3>{t('dashboard.environments.title')}</h3>
            {environments.length === 0 ? (
              <p className="muted">{t('dashboard.environments.empty')}</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('dashboard.cols.environment')}</th>
                    <th>{t('dashboard.cols.classification')}</th>
                    <th>{t('dashboard.cols.repo')}</th>
                    <th className="num">{t('dashboard.cols.deployments')}</th>
                    <th>{t('dashboard.cols.lastDeploy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {environments.map((env) => (
                    <tr key={env.name}>
                      <td className="mono">{env.name}</td>
                      <td>
                        <Classification env={env} />
                      </td>
                      <td className="mono">{env.repos.join(', ')}</td>
                      <td className="num">{env.deployments}</td>
                      <td>
                        <StatusPill status={env.lastStatus} />{' '}
                        <span className="muted">{formatDate(env.lastDeployAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Pagination
              info={data.environments.page}
              value={query.environments}
              onChange={setWindow('environments')}
              disabled={loading}
            />
          </section>

          <div className="grid-2">
            <section className="panel">
              <h3>{t('dashboard.prs.title')}</h3>
              {pullRequests.length === 0 ? (
                <p className="muted">{t('dashboard.prs.empty')}</p>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('dashboard.cols.repo')}</th>
                      <th>{t('dashboard.cols.title')}</th>
                      <th>{t('dashboard.cols.author')}</th>
                      <th className="num">{t('dashboard.cols.ageH')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pullRequests.map((pr) => (
                      <tr key={pr.id} className={pr.ageHours >= stale ? 'stale' : ''}>
                        <td className="mono">
                          <a href={pr.repoUrl} target="_blank" rel="noreferrer">
                            {pr.repo}
                          </a>
                        </td>
                        <td>
                          <a href={pr.url} target="_blank" rel="noreferrer">
                            #{pr.number} {pr.title}
                          </a>
                        </td>
                        <td>{pr.author}</td>
                        <td className="num">{pr.ageHours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Pagination
                info={data.pullRequests.page}
                value={query.prs}
                onChange={setWindow('prs')}
                disabled={loading}
              />
            </section>

            <section className="panel">
              <h3>{t('dashboard.pipelines.title')}</h3>
              {pipelines.length === 0 ? (
                <p className="muted">{t('dashboard.pipelines.empty')}</p>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('dashboard.cols.repo')}</th>
                      <th>{t('dashboard.cols.ref')}</th>
                      <th>{t('dashboard.cols.status')}</th>
                      <th className="num">{t('dashboard.cols.duration')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipelines.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">
                          <a href={p.repoUrl} target="_blank" rel="noreferrer">
                            {p.repo}
                          </a>
                        </td>
                        <td className="mono">
                          <a href={p.url} target="_blank" rel="noreferrer">
                            {p.ref}
                          </a>
                        </td>
                        <td>
                          <StatusPill status={p.status} />
                        </td>
                        <td className="num">{formatDuration(p.durationSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Pagination
                info={data.pipelines.page}
                value={query.pipelines}
                onChange={setWindow('pipelines')}
                disabled={loading}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function RepoFilter({
  repos,
  selected,
  onChange,
}: {
  repos: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const toggle = (repo: string) => {
    const next = new Set(selected);
    if (next.has(repo)) next.delete(repo);
    else next.add(repo);
    onChange(next);
  };

  const label =
    selected.size === 0
      ? t('dashboard.filter.all')
      : t('dashboard.filter.selected', { count: selected.size });

  return (
    <div className="repo-filter">
      <span className="repo-filter-label">{t('dashboard.filter.repos')}</span>
      <div className="multiselect" ref={ref}>
        <button
          type="button"
          className="multiselect-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span>{label}</span>
          <span className="caret">▾</span>
        </button>
        {open && (
          <div className="multiselect-panel">
            <div className="multiselect-actions">
              <button type="button" onClick={() => onChange(new Set(repos))}>
                {t('dashboard.filter.selectAll')}
              </button>
              <button type="button" onClick={() => onChange(new Set())}>
                {t('dashboard.filter.clear')}
              </button>
            </div>
            <ul>
              {repos.map((r) => (
                <li key={r}>
                  <label>
                    <input type="checkbox" checked={selected.has(r)} onChange={() => toggle(r)} />
                    <span>{r}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Attributes and meta-environments of an environment, or a hint when no rule matched. */
function Classification({ env }: { env: DashboardEnvironment }) {
  const { t } = useTranslation();
  const attributes = Object.entries(env.attributes);

  if (attributes.length === 0 && env.metaEnvironments.length === 0) {
    return <span className="muted">{t('dashboard.environments.unclassified')}</span>;
  }

  return (
    <div className="pills">
      {attributes.map(([k, v]) => (
        <span key={k} className="pill attr">
          <b>{k}</b>={v}
        </span>
      ))}
      {env.metaEnvironments.map((m) => (
        <span key={m} className="pill meta">
          {m}
        </span>
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warn' | 'crit' | 'accent';
}) {
  return (
    <div className={`tile ${tone ?? ''}`}>
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: PipelineStatus }) {
  const { t } = useTranslation();
  return <span className={`pill status-${status}`}>{t(`status.${status}`)}</span>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
