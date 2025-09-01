import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, SourcePublic } from '@repo/shared';
import { LayersIcon, ServerIcon, SlidersIcon } from '../icons';
import { GeneralSettings } from './settings/GeneralSettings';
import { SourcesPage } from './SourcesPage';
import { EnvRulesPage } from './EnvRulesPage';

type Section = 'general' | 'sources' | 'env';

const SECTIONS: { key: Section; icon: ReactNode }[] = [
  { key: 'general', icon: <SlidersIcon /> },
  { key: 'sources', icon: <ServerIcon /> },
  { key: 'env', icon: <LayersIcon /> },
];

export function SettingsPage({
  sources,
  selectedSourceId,
  settings,
  onSourcesChange,
  onSettingsChange,
}: {
  sources: SourcePublic[];
  selectedSourceId: string | null;
  settings: AppSettings | null;
  onSourcesChange: () => Promise<void>;
  onSettingsChange: (next: AppSettings) => void;
}) {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>('general');

  return (
    <div className="settings">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-head">{t('settings.title')}</div>
        <nav aria-label={t('settings.title')}>
          <ul>
            {SECTIONS.map(({ key, icon }) => (
              <li key={key}>
                <button
                  className={section === key ? 'settings-link active' : 'settings-link'}
                  onClick={() => setSection(key)}
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
                </button>
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
          (selectedSourceId ? (
            <EnvRulesPage sourceId={selectedSourceId} />
          ) : (
            <p className="muted">{t('settings.env.noSource')}</p>
          ))}
      </div>
    </div>
  );
}
