import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DISPLAY_MODES,
  OVERVIEW_DIRECTIONS,
  PAGE_LIMIT_MAX,
  QUOTA_RESERVE_PCT_MAX,
  QUOTA_RESERVE_PCT_MIN,
  RELEASE_NOTES_GENERATORS,
  type AppSettings,
  type DisplayMode,
  type OverviewDirection,
} from '@repo/shared';
import { api, apiErrorInfo } from '../../api';
import { windowLabel, windowOptions } from '../../doraWindow';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '../../i18n';
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
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState<AppSettings | null>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** Only a failure is worth a line: a success repaints the whole application. */
  const [uiMsg, setUiMsg] = useState<string | null>(null);

  useEffect(() => setForm(settings), [settings]);

  if (!form) return <p className="muted">{t('common.loading')}</p>;

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  /** Saves one presentation key and lets the shell repaint from the answer. */
  async function applyNow(partial: Partial<AppSettings>) {
    setBusy(true);
    setUiMsg(null);
    try {
      onChange(await api.updateSettings(partial));
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setUiMsg(t(code, params));
    } finally {
      setBusy(false);
    }
  }

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
    <div className="grid-2">
      <section className="panel">
        <h2>{t('settings.general.appTitle')}</h2>
        <form onSubmit={submit} className="form">
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
            {t('settings.general.failureSource')}{' '}
            <span className="hint">{t('settings.general.failureSourceHint')}</span>
            <select
              value={form.failureSource}
              onChange={(e) => set('failureSource', e.target.value as AppSettings['failureSource'])}
            >
              {(['pipelines', 'incidents', 'both'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`settings.general.failure.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {/* Only asked for when it is about to be used: an incident label list
              is meaningless while failures come from pipelines alone. */}
          {form.failureSource !== 'pipelines' && (
            <label>
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
            {t('settings.general.releaseNotesGenerator')}{' '}
            <span className="hint">{t('settings.general.releaseNotesGeneratorHint')}</span>
            <select
              value={form.releaseNotesGenerator}
              onChange={(e) =>
                set('releaseNotesGenerator', e.target.value as AppSettings['releaseNotesGenerator'])
              }
            >
              {RELEASE_NOTES_GENERATORS.map((value) => (
                <option key={value} value={value}>
                  {t(`settings.general.generator.${value}`)}
                </option>
              ))}
            </select>
          </label>
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

          {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>{t('settings.general.uiTitle')}</h2>
        {/* Applied as they are picked, like the language above: what each one
            changes is the screen you are looking at, so the effect is the
            confirmation. A Save button would only ask you to agree with what
            you can already see. */}
        <form className="form">
          <label>
            {t('language.label')}{' '}
            <span className="hint">{t('settings.general.languageHint')}</span>
            <select
              value={i18n.resolvedLanguage}
              onChange={(e) => void i18n.changeLanguage(e.target.value)}
            >
              {SUPPORTED_LANGUAGES.map((lng) => (
                <option key={lng} value={lng}>
                  {LANGUAGE_LABELS[lng]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('settings.general.overviewDirection')}{' '}
            <span className="hint">{t('settings.general.overviewDirectionHint')}</span>
            <select
              value={form.overviewDirection}
              disabled={busy}
              onChange={(e) => void applyNow({ overviewDirection: e.target.value as OverviewDirection })}
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
              disabled={busy}
              onChange={(e) => void applyNow({ displayMode: e.target.value as DisplayMode })}
            >
              {DISPLAY_MODES.map((value) => (
                <option key={value} value={value}>
                  {t(`display.mode.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {uiMsg && <div className="banner error">{uiMsg}</div>}
        </form>
      </section>
    </div>
  );
}
