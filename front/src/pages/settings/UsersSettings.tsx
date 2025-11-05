import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PAGE_LIMIT_MAX,
  PASSWORD_MIN_LENGTH,
  type PasswordResetIssued,
  type UserPublic,
  type UserRole,
} from '@repo/shared';
import { api, apiErrorInfo, type CreateUserInput } from '../../api';
import { useAuth } from '../../auth';
import { DeleteIcon, EditIcon, KeyIcon, PlusIcon } from '../../icons';
import { IconButton } from '../../IconButton';
import { ConfirmDialog, Modal } from '../../Modal';

const ROLES: UserRole[] = ['admin', 'user'];

const EMPTY: CreateUserInput = { email: '', name: '', password: '', role: 'user' };

export function UsersSettings() {
  const { t } = useTranslation();
  const { state, refresh } = useAuth();
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [editing, setEditing] = useState<{ user: UserPublic | null } | null>(null);
  const [deleting, setDeleting] = useState<UserPublic | null>(null);
  const [link, setLink] = useState<{ user: UserPublic; issued: PasswordResetIssued } | null>(null);

  const load = useCallback(async () => {
    try {
      // A team, not a directory: ask for the cap and show them all.
      const { items } = await api.listUsers({ limit: PAGE_LIMIT_MAX });
      setUsers(items);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(user: UserPublic) {
    setDeleting(null);
    try {
      await api.deleteUser(user.id);
      setMsg({ kind: 'ok', text: t('users.deleted') });
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  async function issueLink(user: UserPublic) {
    setMsg(null);
    try {
      setLink({ user, issued: await api.issueResetLink(user.id) });
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('users.listTitle')}</h2>
          <button className="btn primary" onClick={() => setEditing({ user: null })}>
            <PlusIcon /> {t('users.addTitle')}
          </button>
        </div>
        <p className="muted subtabs-hint">{t('users.hint')}</p>

        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}

        <table className="data">
          <thead>
            <tr>
              <th>{t('users.form.name')}</th>
              <th>{t('users.form.email')}</th>
              <th>{t('users.form.role')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === state?.user?.id;
              return (
                <tr key={user.id}>
                  <td>
                    {user.name}
                    {isSelf && <span className="muted"> · {t('users.you')}</span>}
                  </td>
                  <td className="mono">{user.email}</td>
                  <td>
                    <span className="pill attr">{t(`users.role.${user.role}`)}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <IconButton label={t('common.edit')} onClick={() => setEditing({ user })}>
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        label={t('users.reset.action')}
                        onClick={() => void issueLink(user)}
                      >
                        <KeyIcon />
                      </IconButton>
                      {/* Deleting the account you are signed in with only ever
                          ends one way; the API would allow it, the UI does not. */}
                      {!isSelf && (
                        <IconButton
                          label={t('common.delete')}
                          tone="danger"
                          onClick={() => setDeleting(user)}
                        >
                          <DeleteIcon />
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {editing && (
        <UserDialog
          user={editing.user}
          onClose={() => setEditing(null)}
          onSaved={async (created) => {
            setEditing(null);
            setMsg({ kind: 'ok', text: t(created ? 'users.added' : 'users.updated') });
            await load();
            // Editing your own account changes the name in the topbar, and may
            // have changed the role the whole UI is drawn from.
            await refresh();
          }}
        />
      )}

      {link && (
        <ResetLinkDialog
          user={link.user}
          issued={link.issued}
          onClose={() => setLink(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('users.deleteTitle')}
          message={t('users.confirmDelete', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/**
 * The link, once. It is not stored anywhere in readable form, so closing this
 * dialog without copying it means issuing another — which is said plainly
 * rather than discovered later.
 */
function ResetLinkDialog({
  user,
  issued,
  onClose,
}: {
  user: UserPublic;
  issued: PasswordResetIssued;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // Built from where this page is served, which is where the link must point.
  const url = `${window.location.origin}/reset/${issued.token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard (an insecure context, typically): the field is selectable.
      setCopied(false);
    }
  }

  const title = t('users.reset.title', { name: user.name });

  return (
    <Modal
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <button className="btn primary" type="button" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="form">
        <p className="muted">
          {t('users.reset.lead', { at: new Date(issued.expiresAt).toLocaleString() })}
        </p>
        <label>
          {t('users.reset.link')}
          <input
            className="mono-input"
            value={url}
            readOnly
            spellCheck={false}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <div className="form-actions">
          <button className="btn" type="button" onClick={() => void copy()}>
            {copied ? t('users.reset.copied') : t('users.reset.copy')}
          </button>
        </div>
        <p className="hint">{t('users.reset.note')}</p>
      </div>
    </Modal>
  );
}

/** Create/edit form, in a modal. `user` null means creation. */
function UserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: UserPublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateUserInput>(
    user ? { email: user.email, name: user.name, password: '', role: user.role } : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateUserInput>(k: K, v: CreateUserInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (user) {
        // An untouched password field means "keep it", not "clear it".
        const { password, ...rest } = form;
        await api.updateUser(user.id, password ? { ...rest, password } : rest);
      } else {
        await api.createUser(form);
      }
      await onSaved(!user);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const title = user ? t('users.editTitle', { name: user.name }) : t('users.addTitle');

  return (
    <Modal
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={busy} type="submit" form="user-form">
            {busy ? t('common.saving') : user ? t('common.save') : t('users.form.submit')}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="form">
        <label>
          {t('users.form.name')}
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        </label>
        <label>
          {t('users.form.email')}
          <input
            className="mono-input"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            spellCheck={false}
            required
          />
        </label>
        <label>
          {t('users.form.password')}{' '}
          <span className="hint">
            {user
              ? t('users.form.passwordKeepHint')
              : t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}
          </span>
          <input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            minLength={form.password ? PASSWORD_MIN_LENGTH : undefined}
            required={!user}
            autoComplete="new-password"
          />
        </label>
        <label>
          {t('users.form.role')} <span className="hint">{t('users.form.roleHint')}</span>
          <select value={form.role} onChange={(e) => set('role', e.target.value as UserRole)}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`users.role.${role}`)}
              </option>
            ))}
          </select>
        </label>

        {error && <div className="banner error">{error}</div>}
      </form>
    </Modal>
  );
}
