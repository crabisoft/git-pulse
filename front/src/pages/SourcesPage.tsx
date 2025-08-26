import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourcePublic, ConnectionTestResult } from '@repo/shared';
import { api, apiErrorInfo, type CreateSourceInput, type UpdateSourceInput } from '../api';
import { CancelIcon, DeleteIcon, EditIcon, TestIcon } from '../icons';

interface FormState {
  name: string;
  kind: 'github' | 'gitlab';
  baseUrl: string;
  authKind: 'token' | 'app';
  owner: string;
  secret: string;
  appId: string;
  privateKey: string;
  installationId: string;
}

const EMPTY: FormState = {
  name: '',
  kind: 'github',
  baseUrl: 'https://github.com',
  authKind: 'token',
  owner: '',
  secret: '',
  appId: '',
  privateKey: '',
  installationId: '',
};

function toInput(form: FormState): CreateSourceInput {
  const base = {
    name: form.name,
    kind: form.kind,
    baseUrl: form.baseUrl,
    authKind: form.authKind,
    scope: { owner: form.owner },
  };
  return form.authKind === 'app'
    ? {
        ...base,
        app: {
          appId: form.appId,
          privateKey: form.privateKey,
          installationId: form.installationId,
        },
      }
    : { ...base, secret: form.secret };
}

/** Same payload, minus the credentials left blank — those keep their stored value. */
function toUpdateInput(form: FormState): UpdateSourceInput {
  const { app, secret, ...base } = toInput(form);
  if (form.authKind === 'app') {
    return app && app.appId && app.privateKey && app.installationId ? { ...base, app } : base;
  }
  return secret ? { ...base, secret } : base;
}

function toForm(source: SourcePublic): FormState {
  return {
    ...EMPTY,
    name: source.name,
    kind: source.kind,
    baseUrl: source.baseUrl,
    authKind: source.authKind,
    owner: source.scope.owner,
  };
}

/** Icon-only action; the label is exposed as both tooltip and accessible name. */
function IconButton({
  label,
  onClick,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: 'danger';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn icon ${tone ?? ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function SourcesPage({
  sources,
  onChange,
}: {
  sources: SourcePublic[];
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [tested, setTested] = useState<Record<string, ConnectionTestResult | 'pending'>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const edited = sources.find((s) => s.id === editing) ?? null;
  // Stored credentials can be kept as-is, unless the auth scheme itself changes.
  const secretRequired = !edited || edited.authKind !== form.authKind;
  const appTouched = Boolean(form.appId || form.privateKey || form.installationId);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function startEdit(source: SourcePublic) {
    setEditing(source.id);
    setForm(toForm(source));
    setMsg(null);
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY);
    setMsg(null);
  }

  function changeKind(kind: FormState['kind']) {
    setForm((f) => ({
      ...f,
      kind,
      // Only prefill the default host when creating: while editing, the base URL
      // must keep reflecting the edited source (often a self-hosted instance).
      baseUrl: editing ? f.baseUrl : kind === 'github' ? 'https://github.com' : 'https://gitlab.com',
      // GitLab supports token auth only.
      authKind: kind === 'gitlab' ? 'token' : f.authKind,
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (editing) {
        await api.updateSource(editing, toUpdateInput(form));
        setEditing(null);
        setMsg({ kind: 'ok', text: t('sources.updated') });
      } else {
        await api.createSource(toInput(form));
        setMsg({ kind: 'ok', text: t('sources.added') });
      }
      setForm(EMPTY);
      await onChange();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setTested((cur) => ({ ...cur, [id]: 'pending' }));
    try {
      const r = await api.testSource(id);
      setTested((cur) => ({ ...cur, [id]: r }));
    } catch (err) {
      setTested((cur) => ({ ...cur, [id]: { ok: false, message: apiErrorInfo(err) } }));
    }
  }

  async function remove(source: SourcePublic) {
    if (!window.confirm(t('sources.confirmDelete', { name: source.name }))) return;
    try {
      await api.deleteSource(source.id);
      if (editing === source.id) cancelEdit();
      await onChange();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  return (
    <div className="grid-2">
      <section className="panel">
        <h2>{t('sources.listTitle')}</h2>
        {sources.length === 0 && <p className="muted">{t('sources.listEmpty')}</p>}
        <ul className="source-list">
          {sources.map((s) => {
            const ts = tested[s.id];
            return (
              <li key={s.id} className={editing === s.id ? 'source-row editing' : 'source-row'}>
                <div>
                  <div className="source-name">
                    {s.name} <span className={`kind-badge ${s.kind}`}>{s.kind}</span>
                  </div>
                  <div className="source-meta">
                    {s.baseUrl} · {s.scope.owner} · {t('sources.auth')}: {s.authKind}
                  </div>
                  {ts && (
                    <div className="source-test">
                      {ts === 'pending'
                        ? '…'
                        : `${ts.ok ? '✓' : '✗'} ${t(ts.message.code, ts.message.params)}`}
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  <IconButton label={t('common.edit')} onClick={() => startEdit(s)}>
                    <EditIcon />
                  </IconButton>
                  <IconButton label={t('common.test')} onClick={() => void test(s.id)}>
                    <TestIcon />
                  </IconButton>
                  <IconButton label={t('common.delete')} tone="danger" onClick={() => void remove(s)}>
                    <DeleteIcon />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel">
        <h2>{editing ? t('sources.editTitle', { name: edited?.name ?? '' }) : t('sources.addTitle')}</h2>
        <form onSubmit={submit} className="form">
          <label>
            {t('sources.form.name')}
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </label>
          <label>
            {t('sources.form.platform')}
            <select value={form.kind} onChange={(e) => changeKind(e.target.value as FormState['kind'])}>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </select>
          </label>
          <label>
            {t('sources.form.baseUrl')}{' '}
            <span className="hint">{t('sources.form.baseUrlHint')}</span>
            <input value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} required />
          </label>
          <label>
            {form.kind === 'github' ? t('sources.form.org') : t('sources.form.group')}
            <input value={form.owner} onChange={(e) => set('owner', e.target.value)} required />
          </label>
          <label>
            {t('sources.form.auth')}
            <select
              value={form.authKind}
              onChange={(e) => set('authKind', e.target.value as FormState['authKind'])}
            >
              <option value="token">{t('sources.form.authToken')}</option>
              {form.kind === 'github' && <option value="app">{t('sources.form.authApp')}</option>}
            </select>
          </label>

          {form.authKind === 'token' ? (
            <label>
              {t('sources.form.secret')}{' '}
              <span className="hint">
                {secretRequired ? t('sources.form.secretHint') : t('sources.form.secretKeepHint')}
              </span>
              <input
                type="password"
                value={form.secret}
                onChange={(e) => set('secret', e.target.value)}
                required={secretRequired}
                autoComplete="off"
              />
            </label>
          ) : (
            <>
              {!secretRequired && <p className="hint">{t('sources.form.secretKeepHint')}</p>}
              <label>
                {t('sources.form.appId')}
                <input
                  value={form.appId}
                  onChange={(e) => set('appId', e.target.value)}
                  required={secretRequired || appTouched}
                />
              </label>
              <label>
                {t('sources.form.installationId')}
                <input
                  value={form.installationId}
                  onChange={(e) => set('installationId', e.target.value)}
                  required={secretRequired || appTouched}
                />
              </label>
              <label>
                {t('sources.form.privateKey')}{' '}
                <span className="hint">{t('sources.form.privateKeyHint')}</span>
                <textarea
                  value={form.privateKey}
                  onChange={(e) => set('privateKey', e.target.value)}
                  required={secretRequired || appTouched}
                  rows={5}
                  autoComplete="off"
                />
              </label>
            </>
          )}

          {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
          <div className="form-actions">
            <button className="btn primary" disabled={busy} type="submit">
              {busy
                ? t('sources.form.submitting')
                : editing
                  ? t('sources.form.save')
                  : t('sources.form.submit')}
            </button>
            {editing && (
              <button className="btn" type="button" onClick={cancelEdit}>
                <CancelIcon /> {t('common.cancel')}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
