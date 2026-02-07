import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DISPLAY_MODES,
  OVERVIEW_DIRECTIONS,
  PASSWORD_MIN_LENGTH,
  SUPPORTED_LANGUAGES,
  type DisplayMode,
  type Language,
  type OverviewDirection,
  type UserPublic,
} from '@repo/shared';
import { api, apiErrorInfo } from '../api';
import { useAuth } from '../auth';
import { isAvailable } from '../display';
import { initials, nameHue } from '../initials';
import { LANGUAGE_LABELS } from '../languages';

/** The form's shape. Everything is a string: it is what the inputs hold. */
interface FormState {
  name: string;
  currentPassword: string;
  password: string;
  confirm: string;
  /** Empty means "follow the installation default" — see `toInput`. */
  displayDirection: string;
  displayMode: string;
  /** Empty follows the browser — see `toInput`. */
  language: string;
}

function toForm(user: UserPublic): FormState {
  return {
    name: user.name,
    currentPassword: '',
    password: '',
    confirm: '',
    displayDirection: user.display.direction ?? '',
    displayMode: user.display.mode ?? '',
    language: user.language ?? '',
  };
}

/**
 * What one save sends.
 *
 * An untouched field is left out entirely, which is what keeps a save that only
 * changes a theme from asking the server to rename the account to what it is
 * already called. The preferences are the exception: empty is a value there —
 * it hands the choice back to the installation default, and is the only way to
 * stop overriding it once one has.
 */
function toInput(form: FormState, user: UserPublic) {
  return {
    ...(form.name !== user.name && { name: form.name }),
    ...(form.password && { password: form.password, currentPassword: form.currentPassword }),
    ...(form.displayDirection !== (user.display.direction ?? '') && {
      displayDirection: (form.displayDirection || null) as OverviewDirection | null,
    }),
    ...(form.displayMode !== (user.display.mode ?? '') && {
      displayMode: (form.displayMode || null) as DisplayMode | null,
    }),
    ...(form.language !== (user.language ?? '') && {
      language: (form.language || null) as Language | null,
    }),
  };
}

/**
 * Everything an account holds about itself, in one place and behind one Save.
 *
 * The role and the address are read-only: an admin hands those out, and letting
 * an account rewrite either would let it rename itself out from under the
 * person who granted it. Everything else on this page is the account's own,
 * which is why none of it lives in the settings section — that one is what the
 * install is like for everybody.
 */
export function AccountPage({ user }: { user: UserPublic }) {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const [form, setForm] = useState<FormState>(() => toForm(user));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((cur) => ({ ...cur, [key]: value }));
    // A save is what the banner described; the next edit makes it stale.
    setMsg(null);
  }

  const input = toInput(form, user);
  const dirty = Object.keys(input).length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password && form.password !== form.confirm) {
      setMsg({ kind: 'err', text: t('auth.passwordMismatch') });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // One request for all of it, so a rejected password cannot leave a
      // renamed account and a changed theme behind it.
      await api.updateMe(input);
      setForm((cur) => ({ ...cur, currentPassword: '', password: '', confirm: '' }));
      setMsg({ kind: 'ok', text: t('account.saved') });
      // The corner reads the name from the session state, and the whole
      // application reads the presentation from it.
      await refresh();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head account-head">
        <span
          className="avatar avatar-lg"
          aria-hidden="true"
          style={{ '--avatar-hue': nameHue(user.name) } as React.CSSProperties}
        >
          {initials(user.name)}
        </span>
        <div>
          <h2>{t('account.title')}</h2>
          <p className="muted">{t('account.subtitle')}</p>
        </div>
      </div>

      {/* Laid out like the settings section it was pulled out of: full-width
          bands, fields running across them, one button under all of them. */}
      <form onSubmit={submit}>
        <div className="blocks">
          <section className="panel">
            <h2>{t('account.identityTitle')}</h2>
            <p className="hint">{t('account.identityHint')}</p>
            <div className="form across">
              <label>
                {t('account.email')} <span className="hint">{t('account.emailHint')}</span>
                <input className="mono-input" value={user.email} disabled />
              </label>
              <label>
                {t('account.role')} <span className="hint">{t('account.roleHint')}</span>
                <input value={t(`users.role.${user.role}`)} disabled />
              </label>
              <label>
                {t('account.name')} <span className="hint">{t('account.nameHint')}</span>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
              </label>
            </div>
          </section>

          <section className="panel">
            <h2>{t('account.displayTitle')}</h2>
            <p className="hint">{t('account.displayHint')}</p>
            <div className="form across">
              <label>
                {t('account.displayDirection')}
                <select
                  value={form.displayDirection}
                  onChange={(e) => set('displayDirection', e.target.value)}
                >
                  <option value="">{t('account.followInstall')}</option>
                  {OVERVIEW_DIRECTIONS.map((value) => (
                    <option key={value} value={value} disabled={!isAvailable(value)}>
                      {t(`display.direction.${value}`)}
                      {isAvailable(value) ? '' : ` — ${t('display.soon')}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('account.displayMode')}{' '}
                <span className="hint">{t('account.displayModeHint')}</span>
                <select
                  value={form.displayMode}
                  onChange={(e) => set('displayMode', e.target.value)}
                >
                  <option value="">{t('account.followInstall')}</option>
                  {DISPLAY_MODES.map((value) => (
                    <option key={value} value={value}>
                      {t(`display.mode.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('account.language')}{' '}
                <span className="hint">{t('account.languageHint')}</span>
                <select value={form.language} onChange={(e) => set('language', e.target.value)}>
                  <option value="">{t('account.followBrowser')}</option>
                  {SUPPORTED_LANGUAGES.map((lng) => (
                    <option key={lng} value={lng}>
                      {LANGUAGE_LABELS[lng]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="panel">
            <h2>{t('account.passwordTitle')}</h2>
            <p className="hint">{t('account.passwordHint')}</p>
            <div className="form across">
              <label>
                {t('account.currentPassword')}{' '}
                <span className="hint">{t('account.currentPasswordHint')}</span>
                <input
                  type="password"
                  value={form.currentPassword}
                  onChange={(e) => set('currentPassword', e.target.value)}
                  required={form.password.length > 0}
                  autoComplete="current-password"
                />
              </label>
              <label>
                {t('account.newPassword')}{' '}
                <span className="hint">{t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  minLength={form.password ? PASSWORD_MIN_LENGTH : undefined}
                  autoComplete="new-password"
                />
              </label>
              <label>
                {t('auth.confirmPassword')}
                <input
                  type="password"
                  value={form.confirm}
                  onChange={(e) => set('confirm', e.target.value)}
                  required={form.password.length > 0}
                  autoComplete="new-password"
                />
              </label>
              <p className="hint wide">{t('account.sessionsNote')}</p>
            </div>
          </section>
        </div>

        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
        <div className="form-actions page-actions">
          <button className="btn primary" type="submit" disabled={busy || !dirty}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
