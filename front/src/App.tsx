import { useEffect, useState, useCallback, lazy, Suspense, type ReactNode } from 'react';
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
import {
  PAGE_LIMIT_MAX,
  type AppSettings,
  type DisplayMode,
  type DisplayPreference,
  type OverviewDirection,
  type SourcePublic,
} from '@repo/shared';
import { api, apiErrorInfo } from './api';
import { useAuth } from './auth';
import { apply as applyDisplay, effective, watchSystem } from './display';
import { useWallMode } from './wall';
import { SECTION_PATHS, SettingsPage, type SettingsSection } from './pages/SettingsPage';
import { OverviewPage } from './pages/OverviewPage';
import { DoraPage } from './pages/DoraPage';
import { ReleaseNotesPage } from './pages/ReleaseNotesPage';
import { DeploymentsPage } from './pages/DeploymentsPage';
import { DeploymentChangesPage } from './pages/DeploymentChangesPage';
import { ChangelogsPage } from './pages/ChangelogsPage';
import { LoginPage } from './pages/LoginPage';
import { AccountPage } from './pages/AccountPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
/**
 * Loaded on demand: it is the only page that charts, and the charting library
 * is a third of the bundle. Most sessions never open a metric's detail, and
 * those that do can afford one round trip.
 */
const DoraMetricPage = lazy(() =>
  import('./pages/DoraMetricPage').then((m) => ({ default: m.DoraMetricPage })),
);

/** One route per settings section, at its own path. None takes a source. */
const SETTINGS_SECTIONS: SettingsSection[] = [
  'general',
  'users',
  'sources',
  'trackers',
  'env',
  'tickets',
  'ai',
  'jobs',
];

/**
 * Routes the topbar picker drives. Switching source keeps you on the page you
 * were reading, so the pattern is needed as well as the slug.
 *
 * No settings route appears here: settings is an application-wide module.
 * Classification rules are a shared catalogue and ticket rules belong to their
 * tracker, so nothing under Settings is scoped to a source at all.
 */
const SOURCE_ROUTES = [
  '/dashboard/:slug',
  '/dora/:slug/:metric',
  '/dora/:slug',
  '/deployments/:slug/changes',
  '/deployments/:slug',
  '/changelogs/:slug',
  '/release-notes/:slug',
];

/** The source slug the current URL points at, or null on the source-less pages. */
function useRouteSlug(): { pattern: string; slug: string } | null {
  const { pathname } = useLocation();
  for (const pattern of SOURCE_ROUTES) {
    const slug = matchPath(pattern, pathname)?.params.slug;
    if (slug) return { pattern, slug };
  }
  return null;
}

/**
 * Decides what may be rendered at all before anything mounts, so no page fires
 * a request the session cannot make. The shell below only ever runs once the
 * caller is allowed in — as a visitor when the dashboard is public, otherwise
 * as an account.
 */
export function App() {
  const { state, error } = useAuth();
  const { pathname } = useLocation();

  // A reset link has to open when nothing else does — its holder cannot sign
  // in, which is the whole reason they were given one.
  const resetToken = matchPath('/reset/:token', pathname)?.params.token;
  if (resetToken) return <ResetPasswordPage token={resetToken} />;

  if (!state) {
    // Nothing is known yet: the API answering is the only interesting failure.
    return error ? (
      <div className="app">
        <main className="content">
          <div className="banner error">{error}</div>
        </main>
      </div>
    ) : null;
  }

  if (state.setupRequired) return <LoginPage setup />;
  if (!state.user && !state.publicDashboard) return <LoginPage setup={false} />;
  return <AppShell />;
}

function AppShell() {
  const { t, i18n } = useTranslation();
  const { state, signOut } = useAuth();
  const isAdmin = state?.user?.role === 'admin';
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

  /**
   * What was picked from the overview, ahead of the round trip that stores it.
   * Held here rather than in the page so it survives navigating away and back,
   * and so a visitor — who has no account to store anything on — still gets to
   * choose for this browser.
   */
  const [override, setOverride] = useState<Partial<DisplayPreference>>({});

  // The inline script in index.html has already painted from last session's
  // copy; this is where the real preference lands, and where it stays in step
  // with the operating system for as long as `system` is what was chosen.
  const display = effective(settings, {
    direction: override.direction ?? state?.user?.display.direction ?? null,
    mode: override.mode ?? state?.user?.display.mode ?? null,
  });
  useEffect(() => {
    applyDisplay(display);
    return watchSystem(display.mode, () => applyDisplay(display));
  }, [display.direction, display.mode]);

  /** Applied at once, then stored — for an account, which is what has one. */
  const changeDisplay = useCallback(
    async (next: { direction?: OverviewDirection; mode?: DisplayMode }) => {
      setOverride((current) => ({ ...current, ...next }));
      if (!state?.user) return;
      try {
        await api.updateMe({
          ...(next.direction !== undefined && { displayDirection: next.direction }),
          ...(next.mode !== undefined && { displayMode: next.mode }),
        });
      } catch (e) {
        // Snap back to what is actually stored: a choice that looks applied
        // and comes back changed at the next sign-in is worse than a refusal.
        setOverride((current) => {
          const reverted = { ...current };
          for (const key of Object.keys(next) as Array<keyof DisplayPreference>) {
            delete reverted[key];
          }
          return reverted;
        });
        const { code, params } = apiErrorInfo(e);
        setError(t(code, params));
      }
    },
    [state?.user, t],
  );

  useEffect(() => {
    if (route) setLastSlug(route.slug);
  }, [route?.slug]);

  // An unknown slug is handled where it is read, in SourcePage — no effect here.

  /** Same page, other source — or just remembered when the page has no source. */
  const changeSource = (slug: string) => {
    setLastSlug(slug);
    if (route) navigate(generatePath(route.pattern, { slug }));
  };

  // A screen nobody is standing at: the shell steps out of the way, and what
  // is left is the reading itself.
  const wall = useWallMode();
  const module = pathname.split('/')[1] || 'dashboard';
  const withSource = (base: string) => (activeSource ? `${base}/${activeSource.slug}` : base);

  return (
    <div className="app">
      {!wall && (
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
            {t('nav.overview')}
          </Link>
          <Link className={module === 'dora' ? 'tab active' : 'tab'} to={withSource('/dora')}>
            {t('nav.dora')}
          </Link>
          <Link
            className={module === 'deployments' ? 'tab active' : 'tab'}
            to={withSource('/deployments')}
          >
            {t('nav.deployments')}
          </Link>
          <Link
            className={module === 'changelogs' ? 'tab active' : 'tab'}
            to={withSource('/changelogs')}
          >
            {t('nav.changelogs')}
          </Link>
          <Link
            className={module === 'release-notes' ? 'tab active' : 'tab'}
            to={withSource('/release-notes')}
          >
            {t('nav.releaseNotes')}
          </Link>
          {/* Hidden rather than disabled: to a visitor, the section does not exist. */}
          {isAdmin && (
            <Link className={module === 'settings' ? 'tab active' : 'tab'} to="/settings">
              {t('nav.settings')}
            </Link>
          )}
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

          {state?.user ? (
            <div className="account">
              <Link className="account-name" to="/account" title={t('auth.account')}>
                {state.user.name}
              </Link>
              <button className="btn" type="button" onClick={() => void signOut()}>
                {t('auth.signOut')}
              </button>
            </div>
          ) : (
            <Link className="btn" to="/login">
              {t('auth.signIn')}
            </Link>
          )}
        </div>
      </header>
      )}

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
                  <OverviewPage
                    key={source.id}
                    sourceId={source.id}
                    slug={source.slug}
                    staleHours={settings?.stalePrHours ?? null}
                    display={display}
                    onDisplayChange={changeDisplay}
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
                {(source) => (
                  <DoraPage key={source.id} sourceId={source.id} slug={source.slug} />
                )}
              </SourcePage>
            }
          />
          <Route
            path="/dora/:slug/:metric"
            element={
              <SourcePage sources={sources} loaded={loaded} base="/dora">
                {(source) => (
                  <Suspense fallback={null}>
                    <DoraMetricPage key={source.id} sourceId={source.id} slug={source.slug} />
                  </Suspense>
                )}
              </SourcePage>
            }
          />

          <Route
            path="/deployments"
            element={<FirstSource base="/deployments" sources={sources} loaded={loaded} />}
          />
          <Route
            path="/deployments/:slug"
            element={
              <SourcePage sources={sources} loaded={loaded} base="/deployments">
                {(source) => (
                  <DeploymentsPage key={source.id} sourceId={source.id} slug={source.slug} />
                )}
              </SourcePage>
            }
          />

          {/* Its own URL, so "look at what went out" is a link somebody can
              send — and one that survives a refresh. */}
          <Route
            path="/deployments/:slug/changes"
            element={
              <SourcePage sources={sources} loaded={loaded} base="/deployments">
                {(source) => (
                  <DeploymentChangesPage
                    key={source.id}
                    sourceId={source.id}
                    slug={source.slug}
                  />
                )}
              </SourcePage>
            }
          />

          {/* Its own section rather than a tab of the deployments page: what it
              lists outlives the window that page reports over, and most of it
              describes environments that no longer exist. */}
          <Route
            path="/changelogs"
            element={<FirstSource base="/changelogs" sources={sources} loaded={loaded} />}
          />
          <Route
            path="/changelogs/:slug"
            element={
              <SourcePage sources={sources} loaded={loaded} base="/changelogs">
                {(source) => <ChangelogsPage key={source.id} sourceId={source.id} />}
              </SourcePage>
            }
          />

          <Route
            path="/release-notes"
            element={<FirstSource base="/release-notes" sources={sources} loaded={loaded} />}
          />
          <Route
            path="/release-notes/:slug"
            element={
              <SourcePage sources={sources} loaded={loaded} base="/release-notes">
                {(source) => <ReleaseNotesPage key={source.id} sourceId={source.id} />}
              </SourcePage>
            }
          />

          {/* Reached by hand once signed in; otherwise the shell shows instead. */}
          <Route
            path="/login"
            element={state?.user ? <Navigate to="/dashboard" replace /> : <LoginPage setup={false} />}
          />
          <Route
            path="/account"
            element={
              state?.user ? <AccountPage user={state.user} /> : <Navigate to="/login" replace />
            }
          />

          <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
          {SETTINGS_SECTIONS.map((section) => (
            <Route
              key={section}
              path={SECTION_PATHS[section]}
              element={
                isAdmin ? (
                  <SettingsPage
                    section={section}
                    sources={sources}
                    settings={settings}
                    onSourcesChange={refresh}
                    onSettingsChange={setSettings}
                  />
                ) : (
                  // A hidden tab is not protection: the URL is still typeable.
                  <AdminOnly />
                )
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
  const { state } = useAuth();
  // Without the rights to add a source, the call to action is a dead end.
  const canConfigure = state?.user?.role === 'admin';
  return (
    <div className="empty">
      <h2>{t('empty.title')}</h2>
      <p>{t(canConfigure ? 'empty.text' : 'empty.textVisitor')}</p>
      {canConfigure && (
        <Link className="btn primary" to="/settings/sources">
          {t('empty.cta')}
        </Link>
      )}
    </div>
  );
}

/** Settings reached without the role for it — signed in as a user, or as nobody. */
function AdminOnly() {
  const { t } = useTranslation();
  const { state } = useAuth();
  return (
    <div className="empty">
      <h2>{t('auth.adminOnlyTitle')}</h2>
      <p>{t('auth.adminOnlyText')}</p>
      {!state?.user && (
        <Link className="btn primary" to="/login">
          {t('auth.signIn')}
        </Link>
      )}
    </div>
  );
}
