import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourcePublic } from '@repo/shared';
import { api, apiErrorInfo } from './api';
import { SourcesPage } from './pages/SourcesPage';
import { DashboardPage } from './pages/DashboardPage';
import { DoraPage } from './pages/DoraPage';
import { EnvRulesPage } from './pages/EnvRulesPage';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from './i18n';

type View = 'dashboard' | 'dora' | 'env' | 'sources';

export function App() {
  const { t, i18n } = useTranslation();
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
      const { code, params } = apiErrorInfo(e);
      setError(t(code, params));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
            className={view === 'env' ? 'tab active' : 'tab'}
            onClick={() => setView('env')}
          >
            {t('nav.env')}
          </button>
          <button
            className={view === 'sources' ? 'tab active' : 'tab'}
            onClick={() => setView('sources')}
          >
            {t('nav.sources')}
          </button>
        </nav>

        <div className="topbar-right">
          {sources.length > 0 && view !== 'sources' && (
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
          <select
            className="lang-select"
            aria-label={t('language.label')}
            value={i18n.resolvedLanguage}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
          >
            {SUPPORTED_LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>
                {LANGUAGE_LABELS[lng]}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="content">
        {error && <div className="banner error">{error}</div>}

        {view === 'dashboard' &&
          (selected ? (
            <DashboardPage sourceId={selected} />
          ) : (
            <EmptyState onGoToSources={() => setView('sources')} />
          ))}

        {view === 'dora' &&
          (selected ? (
            <DoraPage sourceId={selected} />
          ) : (
            <EmptyState onGoToSources={() => setView('sources')} />
          ))}

        {view === 'env' &&
          (selected ? (
            <EnvRulesPage sourceId={selected} />
          ) : (
            <EmptyState onGoToSources={() => setView('sources')} />
          ))}

        {view === 'sources' && <SourcesPage sources={sources} onChange={refresh} />}
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
