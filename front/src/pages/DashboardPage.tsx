import { useEffect, useState, useCallback } from 'react';
import type { DashboardLive, PipelineStatus } from '@repo/shared';
import { api } from '../api';

export function DashboardPage({ sourceId }: { sourceId: string }) {
  const [data, setData] = useState<DashboardLive | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.live(sourceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="page-head">
        <h2>Vue live</h2>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? 'Actualisation…' : '↻ Actualiser'}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {data && (
        <>
          <div className="tiles">
            <Tile label="PR / MR ouvertes" value={data.summary.openPrs} />
            <Tile label="PR / MR bloquées" value={data.summary.stalePrs} tone="warn" />
            <Tile label="Pipelines en échec" value={data.summary.failedPipelines} tone="crit" />
            <Tile label="Pipelines en cours" value={data.summary.runningPipelines} tone="accent" />
          </div>

          {data.warnings.length > 0 && (
            <div className="banner warn">
              {data.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}

          <div className="grid-2">
            <section className="panel">
              <h3>Pull / Merge Requests</h3>
              {data.pullRequests.length === 0 ? (
                <p className="muted">Aucune PR/MR ouverte.</p>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Repo</th>
                      <th>Titre</th>
                      <th>Auteur</th>
                      <th className="num">Âge (h)</th>
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
              <h3>Pipelines récents</h3>
              {data.pipelines.length === 0 ? (
                <p className="muted">Aucun pipeline.</p>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Repo</th>
                      <th>Ref</th>
                      <th>Statut</th>
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

const STATUS_LABEL: Record<PipelineStatus, string> = {
  success: 'Succès',
  failed: 'Échec',
  running: 'En cours',
  pending: 'En attente',
  canceled: 'Annulé',
  skipped: 'Ignoré',
  unknown: 'Inconnu',
};

function StatusPill({ status }: { status: PipelineStatus }) {
  return <span className={`pill status-${status}`}>{STATUS_LABEL[status]}</span>;
}
