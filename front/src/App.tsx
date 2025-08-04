import { useEffect, useState, useCallback } from 'react';
import type { SourcePublic } from '@repo/shared';
import { api } from './api';
import { SourcesPage } from './pages/SourcesPage';
import { DashboardPage } from './pages/DashboardPage';

type View = 'dashboard' | 'sources';

export function App() {
  const [view, setView] = useState<View>('dashboard');
  const [sources, setSources] = useState<SourcePublic[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listSources();
      setSources(list);
      setSelected((cur) => cur ?? list[0]?.id ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <strong>Git Dashboard</strong>
          <span className="brand-sub">GitHub · GitLab</span>
        </div>
        <nav className="tabs">
          <button
            className={view === 'dashboard' ? 'tab active' : 'tab'}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={view === 'sources' ? 'tab active' : 'tab'}
            onClick={() => setView('sources')}
          >
            Sources
          </button>
        </nav>
        {sources.length > 0 && view === 'dashboard' && (
          <select
            className="source-picker"
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.kind})
              </option>
            ))}
          </select>
        )}
      </header>

      <main className="content">
        {error && <div className="banner error">Erreur API : {error}</div>}

        {view === 'dashboard' &&
          (selected ? (
            <DashboardPage sourceId={selected} />
          ) : (
            <EmptyState onGoToSources={() => setView('sources')} />
          ))}

        {view === 'sources' && (
          <SourcesPage sources={sources} onChange={refresh} />
        )}
      </main>
    </div>
  );
}

function EmptyState({ onGoToSources }: { onGoToSources: () => void }) {
  return (
    <div className="empty">
      <h2>Aucune source configurée</h2>
      <p>Ajoutez une source GitHub ou GitLab pour afficher le dashboard live.</p>
      <button className="btn primary" onClick={onGoToSources}>
        Configurer une source
      </button>
    </div>
  );
}
