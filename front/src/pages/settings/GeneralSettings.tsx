import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  COLLECTION_PAGE_CAP_MAX,
  COLLECTION_PAGE_CAP_MIN,
  DISPLAY_MODES,
  OVERVIEW_DIRECTIONS,
  PAGE_LIMIT_MAX,
  QUOTA_RESERVE_PCT_MAX,
  QUOTA_RESERVE_PCT_MIN,
  RELEASE_NOTES_GENERATORS,
  RETENTION_MARGIN_MAX,
  RETENTION_MARGIN_MIN,
  type AppSettings,
  type DisplayMode,
  type OverviewDirection,
} from '@repo/shared';
import { api, apiErrorInfo } from '../../api';
import { windowLabel, windowOptions } from '../../doraWindow';
import { isAvailable } from '../../display';

/** Typed as a list end to end; comma separation is only how it is edited. */
function toLabels(raw: string): string[] {
  return raw
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
}

export function GeneralSettings({
  settings,
  onChange,
}: {
  settings: AppSettings | null;
  onChange: (next: AppSettings) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<AppSettings | null>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => setForm(settings), [settings]);

  if (!form) return <p className="muted">{t('common.loading')}</p>;

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    // A save is what the banner described; the next edit makes it stale.
    setMsg(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setMsg(null);
    try {
      onChange(await api.updateSettings(form));
      setMsg({ kind: 'ok', text: t('settings.general.saved') });
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    } finally {
      setBusy(false);
    }
  }

  return (
    /* One form over the whole page: every block below is stored in the same
       table and saved by the same button, so splitting them into forms of
       their own would only ask for the same round trip several times. */
    <form onSubmit={submit} className="settings-page">
      <div className="blocks">
        <section className="panel">
          <h2>{t('settings.general.reportingTitle')}</h2>
          <p className="hint">{t('settings.general.reportingHint')}</p>
          <div className="form across">
            <label>
              {t('settings.general.doraWindowDays')}{' '}
              <span className="hint">{t('settings.general.doraWindowDaysHint')}</span>
              <select
                value={form.doraWindowDays}
                onChange={(e) => set('doraWindowDays', Number(e.target.value))}
              >
                {windowOptions(form.doraWindowDays).map((days) => (
                  <option key={days} value={days}>
                    {windowLabel(t, days)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('settings.general.stalePrHours')}{' '}
              <span className="hint">{t('settings.general.stalePrHoursHint')}</span>
              <input
                type="number"
                min={1}
                max={8760}
                value={form.stalePrHours}
                onChange={(e) => set('stalePrHours', Number(e.target.value))}
                required
              />
            </label>
            <label>
              {t('settings.general.failureSource')}{' '}
              <span className="hint">{t('settings.general.failureSourceHint')}</span>
              <select
                value={form.failureSource}
                onChange={(e) =>
                  set('failureSource', e.target.value as AppSettings['failureSource'])
                }
              >
                {(['pipelines', 'incidents', 'both'] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`settings.general.failure.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            {/* Only asked for when it is about to be used: an incident label
                list is meaningless while failures come from pipelines alone. */}
            {form.failureSource !== 'pipelines' && (
              <label className="wide">
                {t('settings.general.incidentLabels')}{' '}
                <span className="hint">{t('settings.general.incidentLabelsHint')}</span>
                <input
                  className="mono-input"
                  value={form.incidentLabels.join(', ')}
                  onChange={(e) => set('incidentLabels', toLabels(e.target.value))}
                  spellCheck={false}
                  required
                />
              </label>
            )}
            {/* Empty is a valid answer and the common one — most installs have
                one deployable per repo and nothing to designate. */}
            <label className="wide">
              {t('settings.general.componentAttribute')}{' '}
              <span className="hint">{t('settings.general.componentAttributeHint')}</span>
              <input
                className="mono-input"
                value={form.componentAttribute ?? ''}
                onChange={(e) => set('componentAttribute', e.target.value.trim() || null)}
                spellCheck={false}
                placeholder={t('settings.general.componentAttributePlaceholder')}
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <h2>{t('settings.general.collectionTitle')}</h2>
          <p className="hint">{t('settings.general.collectionHint')}</p>
          <div className="form across">
            <label>
              {t('settings.general.collectCron')}{' '}
              <span className="hint">{t('settings.general.collectCronHint')}</span>
              <input
                className="mono-input"
                value={form.collectCron}
                onChange={(e) => set('collectCron', e.target.value)}
                required
                spellCheck={false}
              />
            </label>
            <label>
              {t('settings.general.pruneCron')}{' '}
              <span className="hint">{t('settings.general.pruneCronHint')}</span>
              <input
                className="mono-input"
                value={form.pruneCron}
                onChange={(e) => set('pruneCron', e.target.value)}
                required
                spellCheck={false}
              />
            </label>
            <label>
              {t('settings.general.retentionMargin')}{' '}
              <span className="hint">{t('settings.general.retentionMarginHint')}</span>
              <input
                type="number"
                min={RETENTION_MARGIN_MIN}
                max={RETENTION_MARGIN_MAX}
                value={form.retentionMarginDays}
                onChange={(e) => set('retentionMarginDays', Number(e.target.value))}
                required
              />
            </label>
            <label>
              {t('settings.general.quotaReservePct')}{' '}
              <span className="hint">{t('settings.general.quotaReservePctHint')}</span>
              <input
                type="number"
                min={QUOTA_RESERVE_PCT_MIN}
                max={QUOTA_RESERVE_PCT_MAX}
                value={form.quotaReservePct}
                onChange={(e) => set('quotaReservePct', Number(e.target.value))}
                required
              />
            </label>
            <label>
              {t('settings.general.collectionPageCap')}{' '}
              <span className="hint">{t('settings.general.collectionPageCapHint')}</span>
              <input
                type="number"
                min={COLLECTION_PAGE_CAP_MIN}
                max={COLLECTION_PAGE_CAP_MAX}
                value={form.collectionPageCap}
                onChange={(e) => set('collectionPageCap', Number(e.target.value))}
                required
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <h2>{t('settings.general.uiTitle')}</h2>
          <p className="hint">{t('settings.general.uiHint')}</p>
          <div className="form across">
            <label>
              {t('settings.general.overviewDirection')}{' '}
              <span className="hint">{t('settings.general.overviewDirectionHint')}</span>
              <select
                value={form.overviewDirection}
                onChange={(e) => set('overviewDirection', e.target.value as OverviewDirection)}
              >
                {OVERVIEW_DIRECTIONS.map((value) => (
                  <option key={value} value={value} disabled={!isAvailable(value)}>
                    {t(`display.direction.${value}`)}
                    {isAvailable(value) ? '' : ` — ${t('display.soon')}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('settings.general.displayMode')}{' '}
              <span className="hint">{t('settings.general.displayModeHint')}</span>
              <select
                value={form.displayMode}
                onChange={(e) => set('displayMode', e.target.value as DisplayMode)}
              >
                {DISPLAY_MODES.map((value) => (
                  <option key={value} value={value}>
                    {t(`display.mode.${value}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="panel">
          <h2>{t('settings.general.accessTitle')}</h2>
          <p className="hint">{t('settings.general.accessHint')}</p>
          <div className="form across">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.publicDashboard}
                onChange={(e) => set('publicDashboard', e.target.checked)}
              />
              <span>
                {t('settings.general.publicDashboard')}{' '}
                <span className="hint">{t('settings.general.publicDashboardHint')}</span>
              </span>
            </label>
            <label>
              {t('settings.general.pageSize')}{' '}
              <span className="hint">{t('settings.general.pageSizeHint')}</span>
              <input
                type="number"
                min={1}
                max={PAGE_LIMIT_MAX}
                value={form.pageSize}
                onChange={(e) => set('pageSize', Number(e.target.value))}
                required
              />
            </label>
            <label>
              {t('settings.general.releaseNotesGenerator')}{' '}
              <span className="hint">{t('settings.general.releaseNotesGeneratorHint')}</span>
              <select
                value={form.releaseNotesGenerator}
                onChange={(e) =>
                  set(
                    'releaseNotesGenerator',
                    e.target.value as AppSettings['releaseNotesGenerator'],
                  )
                }
              >
                {RELEASE_NOTES_GENERATORS.map((value) => (
                  <option key={value} value={value}>
                    {t(`settings.general.generator.${value}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </div>

      {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
      {/* Sticky: the blocks are saved together, and a button that scrolls away
          reads as one block's own rather than as the page's. */}
      <div className="form-actions page-actions">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
