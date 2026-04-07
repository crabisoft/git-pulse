import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { AppSettings, SourcePublic } from '@repo/shared';
import {
  ActivityIcon,
  KeyIcon,
  LayersIcon,
  LinkIcon,
  ServerIcon,
  SlidersIcon,
  TagIcon,
  TicketIcon,
  UsersIcon,
} from '../icons';
import { GeneralSettings } from './settings/GeneralSettings';
import { JobsSettings } from './settings/JobsSettings';
import { UsersSettings } from './settings/UsersSettings';
import { SourcesPage } from './SourcesPage';
import { EnvRulesPage } from './EnvRulesPage';
import { TicketRulesPage } from './TicketRulesPage';
import { VersionRulesPage } from './VersionRulesPage';
import { TrackersPage } from './TrackersPage';
import { LlmProvidersPage } from './LlmProvidersPage';

export type SettingsSection =
  | 'general'
  | 'users'
  | 'sources'
  | 'trackers'
  | 'env'
  | 'tickets'
  | 'versions'
  | 'ai'
  | 'jobs';

const SECTIONS: { key: SettingsSection; icon: ReactNode }[] = [
  { key: 'general', icon: <SlidersIcon /> },
  { key: 'users', icon: <UsersIcon /> },
  { key: 'sources', icon: <ServerIcon /> },
  { key: 'trackers', icon: <LinkIcon /> },
  { key: 'env', icon: <LayersIcon /> },
  { key: 'tickets', icon: <TicketIcon /> },
  // Beside the other rule catalogues: it is one, and it reads what a
  // classification rule names.
  { key: 'versions', icon: <TagIcon /> },
  { key: 'ai', icon: <KeyIcon /> },
  // Last, and on its own: everything above configures the install, this one
  // watches it run.
  { key: 'jobs', icon: <ActivityIcon /> },
];

/**
 * Settings is an application-wide module, and every section is now global:
 * classification rules are a shared catalogue, ticket rules belong to their
 * tracker. Nothing here reads the topbar source picker, which is why it is
 * hidden under Settings.
 *
 * Paths are spelled out rather than derived from the key: `env` reads better in
 * the code, `environments` in a URL.
 */
export const SECTION_PATHS: Record<SettingsSection, string> = {
  general: '/settings/general',
  users: '/settings/users',
  sources: '/settings/sources',
  trackers: '/settings/trackers',
  env: '/settings/environments',
  tickets: '/settings/tickets',
  versions: '/settings/versions',
  ai: '/settings/ai',
  jobs: '/settings/jobs',
};


export function SettingsPage({
  section,
  sources,
  settings,
  onSourcesChange,
  onSettingsChange,
}: {
  section: SettingsSection;
  sources: SourcePublic[];
  settings: AppSettings | null;
  onSourcesChange: () => Promise<void>;
  onSettingsChange: (next: AppSettings) => void;
}) {
  const { t } = useTranslation();

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
                  to={SECTION_PATHS[key]}
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
        </div>
        {section === 'general' && (
          <GeneralSettings settings={settings} onChange={onSettingsChange} />
        )}
        {section === 'users' && <UsersSettings />}
        {section === 'sources' && <SourcesPage onChange={onSourcesChange} />}
        {section === 'trackers' && <TrackersPage sources={sources} />}
        {section === 'env' && <EnvRulesPage />}
        {section === 'tickets' && <TicketRulesPage />}
        {section === 'versions' && <VersionRulesPage />}
        {section === 'ai' && <LlmProvidersPage />}
        {section === 'jobs' && <JobsSettings sources={sources} />}
      </div>
    </div>
  );
}
