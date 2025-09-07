import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { AppSettings, SourcePublic } from '@repo/shared';
import { LayersIcon, ServerIcon, SlidersIcon } from '../icons';
import { GeneralSettings } from './settings/GeneralSettings';
import { SourcesPage } from './SourcesPage';
import { EnvRulesPage } from './EnvRulesPage';

export type SettingsSection = 'general' | 'sources' | 'env';

const SECTIONS: { key: SettingsSection; icon: ReactNode }[] = [
  { key: 'general', icon: <SlidersIcon /> },
  { key: 'sources', icon: <ServerIcon /> },
  { key: 'env', icon: <LayersIcon /> },
];

/** Each section has its own URL; `env` also carries the source it applies to. */
function sectionPath(section: SettingsSection, source: SourcePublic | null): string {
  if (section !== 'env') return `/settings/${section}`;
  return source ? `/settings/environments/${source.slug}` : '/settings/environments';
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
        </div>
        {section === 'general' && (
          <GeneralSettings settings={settings} onChange={onSettingsChange} />
        )}
        {section === 'sources' && <SourcesPage onChange={onSourcesChange} />}
        {section === 'env' &&
          (selectedSource ? (
            <EnvRulesPage sourceId={selectedSource.id} />
          ) : (
            <p className="muted">{t('settings.env.noSource')}</p>
          ))}
      </div>
    </div>
  );
}
