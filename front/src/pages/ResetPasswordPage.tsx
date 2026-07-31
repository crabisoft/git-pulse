import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PASSWORD_MIN_LENGTH, type PasswordResetTarget } from '@repo/shared';
import logo from '../assets/logo.png';
import { api, apiErrorInfo } from '../api';
import { useAuth } from '../auth';

/**
 * The page a reset link opens. Rendered outside the application shell: whoever
 * follows the link has no session by definition, and may be arriving at an
 * install that shows nothing at all without one.
 */
export function ResetPasswordPage({ token }: { token: string }) {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const [target, setTarget] = useState<PasswordResetTarget | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Checked before anything is typed: a stale link says so straight away.
  useEffect(() => {
    api.resetTarget(token).then(setTarget, (e) => {
      const { code, params } = apiErrorInfo(e);
      setError(t(code, params));
    });
  }, [token, t]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      // Every session of that account is gone, this browser's included.
      await refresh();
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
        <h2>{t('reset.title')}</h2>

        {done ? (
          <>
            <p className="muted auth-lead">{t('reset.done')}</p>
            <Link className="btn primary" to="/login">
              {t('auth.signIn')}
            </Link>
          </>
        ) : (
          <>
            <p className="muted auth-lead">
              {target ? t('reset.lead', { email: target.email }) : t('common.loading')}
            </p>

            {/* Without a target there is no link to spend: only the reason shows. */}
            {target && (
              <form className="form" onSubmit={submit}>
                <label>
                  {t('account.newPassword')}{' '}
                  <span className="hint">
                    {t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                    autoComplete="new-password"
                    autoFocus
                  />
                </label>
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

                <div className="form-actions">
                  <button className="btn primary" type="submit" disabled={busy}>
                    {busy ? t('common.saving') : t('reset.submit')}
                  </button>
                </div>
              </form>
            )}

            {error && <div className="banner error">{error}</div>}
          </>
        )}
      </section>
    </div>
  );
}
