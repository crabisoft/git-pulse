import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import type { AppSettings, SourcePublic } from '@repo/shared';
import { LayersIcon, LinkIcon, ServerIcon, SlidersIcon, TicketIcon } from '../icons';
import { GeneralSettings } from './settings/GeneralSettings';
import { SourcesPage } from './SourcesPage';
import { EnvRulesPage } from './EnvRulesPage';
import { TicketRulesPage } from './TicketRulesPage';
import { TrackersPage } from './TrackersPage';

export type SettingsSection = 'general' | 'sources' | 'trackers' | 'env' | 'tickets';

const SECTIONS: { key: SettingsSection; icon: ReactNode }[] = [
  { key: 'general', icon: <SlidersIcon /> },
  { key: 'sources', icon: <ServerIcon /> },
  { key: 'trackers', icon: <LinkIcon /> },
  { key: 'env', icon: <LayersIcon /> },
  { key: 'tickets', icon: <TicketIcon /> },
];

/**
 * Settings is an application-wide module: most sections have nothing to do with
 * a source. The two that do carry it in their own URL and pick it through their
 * own selector — the topbar picker is hidden here, so this is the only control
 * over that scope.
 */
const SOURCE_SECTIONS: Record<string, string> = {
  env: '/settings/environments',
  tickets: '/settings/tickets',
};

/** Carries the current source across source-bound sections, so switching from
 *  Environments to Tickets does not silently reset the scope. */
function sectionPath(section: SettingsSection, source: SourcePublic | null): string {
  const base = SOURCE_SECTIONS[section];
  if (!base) return `/settings/${section}`;
  return source ? `${base}/${source.slug}` : base;
}

export function SettingsPage({
  section,
  sources,
  selectedSource,
  settings,
  onSourcesChange,
  onSettingsChange,
}: {
  section: SettingsSection;
  sources: SourcePublic[];
  selectedSource: SourcePublic | null;
  settings: AppSettings | null;
  onSourcesChange: () => Promise<void>;
  onSettingsChange: (next: AppSettings) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const base = SOURCE_SECTIONS[section];

  return (
    <div className="settings">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-head">{t('settings.title')}</div>
        <nav aria-label={t('settings.title')}>
          <ul>
            {SECTIONS.map(({ key, icon }) => (
              <li key={key}>
                <Link
                  className={section === key ? 'settings-link active' : 'settings-link'}
                  to={sectionPath(key, selectedSource)}
                  aria-current={section === key ? 'page' : undefined}
                >
                  <span className="settings-link-icon">{icon}</span>
                  <span className="settings-link-text">
                    <span className="settings-link-label">{t(`settings.section.${key}`)}</span>
                    <span className="settings-link-desc">{t(`settings.desc.${key}`)}</span>
                  </span>
                  {key === 'sources' && sources.length > 0 && (
                    <span className="settings-link-badge">{sources.length}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="settings-body">
        <div className="page-head">
          <h2>{t(`settings.section.${section}`)}</h2>
          {/* Scope of the section, owned by the section. Rendered even for a
              single source, so what the rules below apply to is never implicit. */}
          {base && selectedSource && (
            <label className="settings-scope">
              {t('settings.scope')}
              <select
                value={selectedSource.slug}
                onChange={(e) => navigate(`${base}/${e.target.value}`)}
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.slug}>
                    {source.name} ({source.kind})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {section === 'general' && (
          <GeneralSettings settings={settings} onChange={onSettingsChange} />
        )}
        {section === 'sources' && <SourcesPage onChange={onSourcesChange} />}
        {section === 'trackers' && <TrackersPage sources={sources} />}
        {section === 'env' &&
          (selectedSource ? (
            <EnvRulesPage sourceId={selectedSource.id} />
          ) : (
            <p className="muted">{t('settings.env.noSource')}</p>
          ))}
        {section === 'tickets' &&
          (selectedSource ? (
            <TicketRulesPage sourceId={selectedSource.id} />
          ) : (
            <p className="muted">{t('settings.env.noSource')}</p>
          ))}
      </div>
    </div>
  );
}
