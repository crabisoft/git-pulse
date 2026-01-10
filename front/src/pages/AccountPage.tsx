import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DISPLAY_MODES,
  OVERVIEW_DIRECTIONS,
  PASSWORD_MIN_LENGTH,
  type DisplayMode,
  type OverviewDirection,
  type UserPublic,
} from '@repo/shared';
import { api, apiErrorInfo } from '../api';
import { useAuth } from '../auth';
import { isAvailable } from '../display';

/**
 * What an account can do about itself without an admin. Deliberately thin: the
 * role and the address are how an admin identifies it, so only the name and the
 * password are here — and the password only against the current one.
 */
export function AccountPage({ user }: { user: UserPublic }) {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** Only a failure is worth a line: a success repaints the application. */
  const [displayMsg, setDisplayMsg] = useState<string | null>(null);

  /**
   * Saves one presentation choice. Null is a value here and not an omission:
   * it hands the choice back to the installation default, which is the only
   * way to stop overriding it once one has.
   */
  async function applyDisplay(input: {
    displayDirection?: OverviewDirection | null;
    displayMode?: DisplayMode | null;
  }) {
    setBusy(true);
    setDisplayMsg(null);
    try {
      await api.updateMe(input);
      await refresh();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setDisplayMsg(t(code, params));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password && password !== confirm) {
      setMsg({ kind: 'err', text: t('auth.passwordMismatch') });
      return;
    }
    setBusy(true);
    setMsg(null);
    // One request for both, so a rejected password cannot leave a renamed
    // account behind it. An untouched field is simply not sent.
    const input = {
      ...(name !== user.name && { name }),
      ...(password && { password, currentPassword }),
    };
    try {
      await api.updateMe(input);
      setCurrentPassword('');
      setPassword('');
      setConfirm('');
      setMsg({ kind: 'ok', text: t('account.saved') });
      // The topbar reads the name from the session state.
      await refresh();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-narrow">
      <div className="page-head">
        <h2>{t('account.title')}</h2>
      </div>

      <section className="panel">
        <form className="form" onSubmit={submit}>
          <label>
            {t('account.email')} <span className="hint">{t('account.emailHint')}</span>
            <input className="mono-input" value={user.email} disabled />
          </label>
          <label>
            {t('account.role')} <span className="hint">{t('account.roleHint')}</span>
            <input value={t(`users.role.${user.role}`)} disabled />
          </label>
          <label>
            {t('account.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>

          <h3 className="form-section">{t('account.passwordTitle')}</h3>
          <label>
            {t('account.currentPassword')}{' '}
            <span className="hint">{t('account.currentPasswordHint')}</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required={password.length > 0}
              autoComplete="current-password"
            />
          </label>
          <label>
            {t('account.newPassword')}{' '}
            <span className="hint">{t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={password ? PASSWORD_MIN_LENGTH : undefined}
              autoComplete="new-password"
            />
          </label>
          <label>
            {t('auth.confirmPassword')}
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required={password.length > 0}
              autoComplete="new-password"
            />
          </label>
          <p className="hint">{t('account.sessionsNote')}</p>

          {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h3 className="form-section">{t('account.displayTitle')}</h3>
        <p className="hint">{t('account.displayHint')}</p>
        {/* Its own form, applied on the spot: unlike a name or a password,
            what these change is visible the instant they are picked, so
            holding them behind a Save button would only add a step. */}
        <form className="form">
          <label>
            {t('account.displayDirection')}
            <select
              value={user.display.direction ?? ''}
              disabled={busy}
              onChange={(e) =>
                void applyDisplay({
                  displayDirection: (e.target.value || null) as OverviewDirection | null,
                })
              }
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
            {t('account.displayMode')}
            <select
              value={user.display.mode ?? ''}
              disabled={busy}
              onChange={(e) =>
                void applyDisplay({ displayMode: (e.target.value || null) as DisplayMode | null })
              }
            >
              <option value="">{t('account.followInstall')}</option>
              {DISPLAY_MODES.map((value) => (
                <option key={value} value={value}>
                  {t(`display.mode.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {displayMsg && <div className="banner error">{displayMsg}</div>}
        </form>
      </section>
    </div>
  );
}
