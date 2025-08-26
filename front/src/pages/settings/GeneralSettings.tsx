import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings } from '@repo/shared';
import { api, apiErrorInfo } from '../../api';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '../../i18n';

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

  useEffect(() => setForm(settings), [settings]);

  if (!form) return <p className="muted">{t('common.loading')}</p>;

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

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
            <input
              type="number"
              min={1}
              max={365}
              value={form.doraWindowDays}
              onChange={(e) => set('doraWindowDays', Number(e.target.value))}
              required
            />
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
        </form>
      </section>
    </div>
  );
}
