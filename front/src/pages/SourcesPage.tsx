import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourcePublic, ConnectionTestResult } from '@repo/shared';
import { api, apiErrorInfo, type CreateSourceInput, type UpdateSourceInput } from '../api';
import { DeleteIcon, EditIcon, PlusIcon, TestIcon } from '../icons';
import { IconButton } from '../IconButton';
import { ConfirmDialog, Modal } from '../Modal';

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

export function SourcesPage({
  sources,
  onChange,
}: {
  sources: SourcePublic[];
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [tested, setTested] = useState<Record<string, ConnectionTestResult | 'pending'>>({});
  /** Open editor: `null` source means creation. */
  const [editing, setEditing] = useState<{ source: SourcePublic | null } | null>(null);
  const [deleting, setDeleting] = useState<SourcePublic | null>(null);

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
    setDeleting(null);
    try {
      await api.deleteSource(source.id);
      setMsg({ kind: 'ok', text: t('sources.deleted') });
      await onChange();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  async function saved(created: boolean) {
    setEditing(null);
    setMsg({ kind: 'ok', text: created ? t('sources.added') : t('sources.updated') });
    await onChange();
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('sources.listTitle')}</h2>
          <button className="btn primary with-icon" onClick={() => setEditing({ source: null })}>
            <PlusIcon /> {t('sources.addTitle')}
          </button>
        </div>

        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
        {sources.length === 0 && <p className="muted">{t('sources.listEmpty')}</p>}

        <ul className="source-list">
          {sources.map((s) => {
            const ts = tested[s.id];
            return (
              <li key={s.id} className="source-row">
                <div>
                  <div className="source-name">
                    {s.name} <span className={`kind-badge ${s.kind}`}>{s.kind}</span>
                  </div>
                  <div className="source-meta">
                    {s.baseUrl} · {s.scope.owner} · {t('sources.auth')}: {s.authKind}
                  </div>
                  {ts && (
                    <div className={`source-test ${ts === 'pending' ? '' : ts.ok ? 'ok' : 'err'}`}>
                      {ts === 'pending'
                        ? t('common.testing')
                        : `${ts.ok ? '✓' : '✗'} ${t(ts.message.code, ts.message.params)}`}
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  <IconButton label={t('common.edit')} onClick={() => setEditing({ source: s })}>
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    label={t('common.test')}
                    disabled={ts === 'pending'}
                    onClick={() => void test(s.id)}
                  >
                    <TestIcon />
                  </IconButton>
                  <IconButton label={t('common.delete')} tone="danger" onClick={() => setDeleting(s)}>
                    <DeleteIcon />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {editing && (
        <SourceDialog
          source={editing.source}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('sources.deleteTitle')}
          message={t('sources.confirmDelete', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** Create/edit form, in a modal. `source` null means creation. */
function SourceDialog({
  source,
  onClose,
  onSaved,
}: {
  source: SourcePublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(source ? toForm(source) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stored credentials can be kept as-is, unless the auth scheme itself changes.
  const secretRequired = !source || source.authKind !== form.authKind;
  const appTouched = Boolean(form.appId || form.privateKey || form.installationId);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function changeKind(kind: FormState['kind']) {
    setForm((f) => ({
      ...f,
      kind,
      // Only prefill the default host when creating: while editing, the base URL
      // must keep reflecting the edited source (often a self-hosted instance).
      baseUrl: source ? f.baseUrl : kind === 'github' ? 'https://github.com' : 'https://gitlab.com',
      // GitLab supports token auth only.
      authKind: kind === 'gitlab' ? 'token' : f.authKind,
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (source) await api.updateSource(source.id, toUpdateInput(form));
      else await api.createSource(toInput(form));
      await onSaved(!source);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const title = source ? t('sources.editTitle', { name: source.name }) : t('sources.addTitle');

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
          <button className="btn primary" disabled={busy} type="submit" form="source-form">
            {busy ? t('sources.form.submitting') : source ? t('common.save') : t('sources.form.submit')}
          </button>
        </>
      }
    >
      <form id="source-form" onSubmit={submit} className="form">
        <label>
          {t('sources.form.name')}
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        </label>
        <label>
          {t('sources.form.platform')}
          <select value={form.kind} onChange={(e) => changeKind(e.target.value as FormState['kind'])}>
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
        </label>
        <label>
          {t('sources.form.baseUrl')} <span className="hint">{t('sources.form.baseUrlHint')}</span>
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

        {error && <div className="banner error">{error}</div>}
      </form>
    </Modal>
  );
}
