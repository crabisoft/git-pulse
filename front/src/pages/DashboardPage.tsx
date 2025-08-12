import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DashboardLive, PipelineStatus } from '@repo/shared';
import { api, apiErrorInfo } from '../api';

export function DashboardPage({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardLive | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <div className="tiles">
            <Tile label={t('dashboard.tiles.openPrs')} value={data.summary.openPrs} />
            <Tile label={t('dashboard.tiles.stalePrs')} value={data.summary.stalePrs} tone="warn" />
            <Tile
              label={t('dashboard.tiles.failedPipelines')}
              value={data.summary.failedPipelines}
              tone="crit"
            />
            <Tile
              label={t('dashboard.tiles.runningPipelines')}
              value={data.summary.runningPipelines}
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
              {data.pullRequests.length === 0 ? (
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
                    {data.pullRequests.map((pr) => (
                      <tr key={pr.id} className={pr.ageHours >= 72 ? 'stale' : ''}>
                        <td className="mono">{pr.repo}</td>
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
              {data.pipelines.length === 0 ? (
                <p className="muted">{t('dashboard.pipelines.empty')}</p>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('dashboard.cols.repo')}</th>
                      <th>{t('dashboard.cols.ref')}</th>
                      <th>{t('dashboard.cols.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pipelines.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.repo}</td>
                        <td className="mono">{p.ref}</td>
                        <td>
                          <StatusPill status={p.status} />
                        </td>
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
