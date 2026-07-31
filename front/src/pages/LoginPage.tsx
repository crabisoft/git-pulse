import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PASSWORD_MIN_LENGTH } from '@repo/shared';
import logo from '../assets/logo.png';
import { api, apiErrorInfo } from '../api';
import { useAuth } from '../auth';

/**
 * The one screen that shows without a session. It doubles as the first-run
 * form: an install with no account has nobody who could create one, so the very
 * first admin is made here, and the form goes away with the last empty table.
 */
export function LoginPage({ setup }: { setup: boolean }) {
  const { t } = useTranslation();
  const { signIn, refresh } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (setup && password !== confirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (setup) {
        await api.setupAdmin({ email, name, password });
        // The provider owns the state; re-reading it also confirms the cookie.
        await refresh();
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="panel auth-card">
        <div className="brand auth-brand">
          <img className="brand-logo" src={logo} alt="" width={32} height={32} />
          <strong>Git Pulse</strong>
        </div>
        <h2>{t(setup ? 'auth.setupTitle' : 'auth.signInTitle')}</h2>
        <p className="muted auth-lead">{t(setup ? 'auth.setupLead' : 'auth.signInLead')}</p>

        <form className="form" onSubmit={submit}>
          {setup && (
            <label>
              {t('auth.name')}
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </label>
          )}
          <label>
            {t('auth.email')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              autoFocus={!setup}
            />
          </label>
          <label>
            {t('auth.password')}{' '}
            {setup && (
              <span className="hint">{t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}</span>
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={setup ? PASSWORD_MIN_LENGTH : undefined}
              autoComplete={setup ? 'new-password' : 'current-password'}
            />
          </label>
          {setup && (
            <label>
              {t('auth.confirmPassword')}
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            </label>
          )}

          {error && <div className="banner error">{error}</div>}
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy
                ? t('common.saving')
                : t(setup ? 'auth.createAdmin' : 'auth.signIn')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
