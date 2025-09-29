import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Link,
  Navigate,
  Route,
  Routes,
  generatePath,
  matchPath,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { PAGE_LIMIT_MAX, type AppSettings, type SourcePublic } from '@repo/shared';
import { api, apiErrorInfo } from './api';
import { SECTION_PATHS, SettingsPage, type SettingsSection } from './pages/SettingsPage';
import { DashboardPage } from './pages/DashboardPage';
import { DoraPage } from './pages/DoraPage';

/** One route per settings section, at its own path. None takes a source. */
const SETTINGS_SECTIONS: SettingsSection[] = ['general', 'sources', 'trackers', 'env', 'tickets'];

/**
 * Routes the topbar picker drives. Switching source keeps you on the page you
 * were reading, so the pattern is needed as well as the slug.
 *
 * No settings route appears here: settings is an application-wide module.
 * Classification rules are a shared catalogue and ticket rules belong to their
 * tracker, so nothing under Settings is scoped to a source at all.
 */
const SOURCE_ROUTES = ['/dashboard/:slug', '/dora/:slug'];

/** The source slug the current URL points at, or null on the source-less pages. */
function useRouteSlug(): { pattern: string; slug: string } | null {
  const { pathname } = useLocation();
  for (const pattern of SOURCE_ROUTES) {
    const slug = matchPath(pattern, pathname)?.params.slug;
    if (slug) return { pattern, slug };
  }
  return null;
}

export function App() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [sources, setSources] = useState<SourcePublic[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const route = useRouteSlug();
  /** Kept so the nav links still carry a source while on a source-less page. */
  const [lastSlug, setLastSlug] = useState<string | null>(null);
  // Never point the picker or the nav links at a source that no longer exists.
  const candidate = route?.slug ?? lastSlug;
  const activeSource =
    sources.find((s) => s.slug === candidate) ?? (sources.length > 0 ? sources[0] : null);

  const refresh = useCallback(async () => {
    try {
      // The source picker needs every source at once, so ask for the cap.
      const { items } = await api.listSources({ limit: PAGE_LIMIT_MAX });
      setSources(items);
      setError(null);
    } catch (e) {
      const { code, params } = apiErrorInfo(e);
      setError(t(code, params));
    } finally {
      setLoaded(true);
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

  useEffect(() => {
    if (route) setLastSlug(route.slug);
  }, [route?.slug]);

  // An unknown slug is handled where it is read, in SourcePage — no effect here.

  /** Same page, other source — or just remembered when the page has no source. */
  const changeSource = (slug: string) => {
    setLastSlug(slug);
    if (route) navigate(generatePath(route.pattern, { slug }));
  };

  const module = pathname.split('/')[1] || 'dashboard';
  const withSource = (base: string) => (activeSource ? `${base}/${activeSource.slug}` : base);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <strong>Git Dashboard</strong>
          <span className="brand-sub">{t('brand.subtitle')}</span>
        </div>
        <nav className="tabs">
          <Link
            className={module === 'dashboard' ? 'tab active' : 'tab'}
            to={withSource('/dashboard')}
          >
            {t('nav.dashboard')}
          </Link>
          <Link className={module === 'dora' ? 'tab active' : 'tab'} to={withSource('/dora')}>
            {t('nav.dora')}
          </Link>
          <Link className={module === 'settings' ? 'tab active' : 'tab'} to="/settings">
            {t('nav.settings')}
          </Link>
        </nav>

        <div className="topbar-right">
          {/* Nothing under Settings reads it: each section owns its own scope. */}
          {module !== 'settings' && sources.length > 0 && (
            <select
              className="source-picker"
              value={activeSource?.slug ?? ''}
              onChange={(e) => changeSource(e.target.value)}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.name} ({s.kind})
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      <main className={module === 'settings' ? 'content flush' : 'content'}>
        {error && <div className="banner error">{error}</div>}

        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          <Route
            path="/dashboard"
            element={<FirstSource base="/dashboard" sources={sources} loaded={loaded} />}
          />
          <Route
            path="/dashboard/:slug"
            element={
              <SourcePage sources={sources} loaded={loaded} base="/dashboard">
                {(source) => (
                  <DashboardPage
                    key={source.id}
                    sourceId={source.id}
                    staleHours={settings?.stalePrHours ?? null}
                  />
                )}
              </SourcePage>
            }
          />

          <Route
            path="/dora"
            element={<FirstSource base="/dora" sources={sources} loaded={loaded} />}
          />
          <Route
            path="/dora/:slug"
            element={
              <SourcePage sources={sources} loaded={loaded} base="/dora">
                {(source) => <DoraPage key={source.id} sourceId={source.id} />}
              </SourcePage>
            }
          />

          <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
          {SETTINGS_SECTIONS.map((section) => (
            <Route
              key={section}
              path={SECTION_PATHS[section]}
              element={
                <SettingsPage
                  section={section}
                  sources={sources}
                  settings={settings}
                  onSourcesChange={refresh}
                  onSettingsChange={setSettings}
                />
              }
            />
          ))}

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/** `/dashboard` and friends resolve to the first source once they are loaded. */
function FirstSource({
  base,
  sources,
  loaded,
}: {
  base: string;
  sources: SourcePublic[];
  loaded: boolean;
}) {
  if (!loaded) return null;
  if (sources.length === 0) return <EmptyState />;
  return <Navigate to={`${base}/${sources[0].slug}`} replace />;
}

/**
 * Resolves the `:slug` of the URL into a source. The API is addressed by id, so
 * the slug is only ever a routing key — the mapping uses the list already
 * loaded for the picker, without an extra request. An unknown slug falls back
 * to `base`, which redirects to the first source or shows the empty state.
 */
function SourcePage({
  base,
  sources,
  loaded,
  children,
}: {
  base: string;
  sources: SourcePublic[];
  loaded: boolean;
  children: (source: SourcePublic) => ReactNode;
}) {
  const { slug } = useParams();
  if (!loaded) return null;
  const source = sources.find((s) => s.slug === slug);
  if (!source) return <Navigate to={base} replace />;
  return <>{children(source)}</>;
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="empty">
      <h2>{t('empty.title')}</h2>
      <p>{t('empty.text')}</p>
      <Link className="btn primary" to="/settings/sources">
        {t('empty.cta')}
      </Link>
    </div>
  );
}
