import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PAGE_LIMIT_MAX, type AppSettings, type SourcePublic } from '@repo/shared';
import { api, apiErrorInfo } from './api';
import { SettingsPage } from './pages/SettingsPage';
import { DashboardPage } from './pages/DashboardPage';
import { DoraPage } from './pages/DoraPage';

type View = 'dashboard' | 'dora' | 'settings';

export function App() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<View>('dashboard');
  const [sources, setSources] = useState<SourcePublic[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // The source picker needs every source at once, so ask for the cap.
      const { items: list } = await api.listSources({ limit: PAGE_LIMIT_MAX });
      setSources(list);
      // Fall back to the first source when the selected one is gone (deleted).
      setSelected((cur) => (cur && list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? null)));
      setError(null);
    } catch (e) {
      const { code, params } = apiErrorInfo(e);
      setError(t(code, params));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    api.settings().then(setSettings, (e) => {
      const { code, params } = apiErrorInfo(e);
      setError(t(code, params));
    });
  }, [t]);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? 'en';
  }, [i18n.resolvedLanguage]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <strong>Git Dashboard</strong>
          <span className="brand-sub">{t('brand.subtitle')}</span>
        </div>
        <nav className="tabs">
          <button
            className={view === 'dashboard' ? 'tab active' : 'tab'}
            onClick={() => setView('dashboard')}
          >
            {t('nav.dashboard')}
          </button>
          <button
            className={view === 'dora' ? 'tab active' : 'tab'}
            onClick={() => setView('dora')}
          >
            {t('nav.dora')}
          </button>
          <button
            className={view === 'settings' ? 'tab active' : 'tab'}
            onClick={() => setView('settings')}
          >
            {t('nav.settings')}
          </button>
        </nav>

        <div className="topbar-right">
          {sources.length > 0 && (
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
        </div>
      </header>

      <main className={view === 'settings' ? 'content flush' : 'content'}>
        {error && <div className="banner error">{error}</div>}

        {view === 'dashboard' &&
          (selected ? (
            <DashboardPage sourceId={selected} staleHours={settings?.stalePrHours ?? null} />
          ) : (
            <EmptyState onGoToSources={() => setView('settings')} />
          ))}

        {view === 'dora' &&
          (selected ? (
            <DoraPage sourceId={selected} />
          ) : (
            <EmptyState onGoToSources={() => setView('settings')} />
          ))}

        {view === 'settings' && (
          <SettingsPage
            sources={sources}
            selectedSourceId={selected}
            settings={settings}
            onSourcesChange={refresh}
            onSettingsChange={setSettings}
          />
        )}
      </main>
    </div>
  );
}

function EmptyState({ onGoToSources }: { onGoToSources: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="empty">
      <h2>{t('empty.title')}</h2>
      <p>{t('empty.text')}</p>
      <button className="btn primary" onClick={onGoToSources}>
        {t('empty.cta')}
      </button>
    </div>
  );
}
