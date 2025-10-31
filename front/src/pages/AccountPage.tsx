import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PASSWORD_MIN_LENGTH, type UserPublic } from '@repo/shared';
import { api, apiErrorInfo } from '../api';
import { useAuth } from '../auth';

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
    </div>
  );
}
