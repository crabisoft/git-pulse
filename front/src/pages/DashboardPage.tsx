import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DashboardLive, PipelineStatus } from '@repo/shared';
import { api, apiErrorInfo } from '../api';

const STALE_HOURS = 72;

export function DashboardPage({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardLive | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.live(sourceId));
    } catch (e) {
      const { code, params } = apiErrorInfo(e);
      setError(t(code, params));
    } finally {
      setLoading(false);
    }
  }, [sourceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset the repo filter when switching source.
  useEffect(() => {
    setSelectedRepos(new Set());
  }, [sourceId]);

  const repos = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.pullRequests.forEach((p) => set.add(p.repo));
    data.pipelines.forEach((p) => set.add(p.repo));
    return [...set].sort();
  }, [data]);

  const inFilter = (repo: string) => selectedRepos.size === 0 || selectedRepos.has(repo);
  const pullRequests = data ? data.pullRequests.filter((p) => inFilter(p.repo)) : [];
  const pipelines = data ? data.pipelines.filter((p) => inFilter(p.repo)) : [];
  const summary = {
    openPrs: pullRequests.length,
    stalePrs: pullRequests.filter((p) => p.ageHours >= STALE_HOURS).length,
    failedPipelines: pipelines.filter((p) => p.status === 'failed').length,
    runningPipelines: pipelines.filter((p) => p.status === 'running').length,
  };

  return (
    <div>
      <div className="page-head">
        <h2>{t('dashboard.title')}</h2>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? t('common.refreshing') : `↻ ${t('common.refresh')}`}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {data && (
        <>
          {repos.length > 1 && (
            <RepoFilter repos={repos} selected={selectedRepos} onChange={setSelectedRepos} />
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
          </div>

          {data.warnings.length > 0 && (
            <div className="banner warn">
              {data.warnings.map((w, i) => (
                <div key={i}>⚠ {t(w.code, w.params)}</div>
              ))}
            </div>
          )}

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
                      <tr key={pr.id} className={pr.ageHours >= STALE_HOURS ? 'stale' : ''}>
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

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
