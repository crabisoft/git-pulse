import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourcePublic, ConnectionTestResult } from '@repo/shared';
import { api, apiErrorInfo, type CreateSourceInput } from '../api';

const EMPTY: CreateSourceInput = {
  name: '',
  kind: 'github',
  baseUrl: 'https://github.com',
  authKind: 'token',
  secret: '',
  scope: { owner: '' },
};

export function SourcesPage({
  sources,
  onChange,
}: {
  sources: SourcePublic[];
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateSourceInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [tested, setTested] = useState<Record<string, ConnectionTestResult | 'pending'>>({});

  const set = <K extends keyof CreateSourceInput>(k: K, v: CreateSourceInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.createSource(form);
      setForm(EMPTY);
      setMsg({ kind: 'ok', text: t('sources.added') });
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

  async function remove(id: string) {
    try {
      await api.deleteSource(id);
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
              <li key={s.id} className="source-row">
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
                  <button className="btn" onClick={() => test(s.id)}>
                    {t('common.test')}
                  </button>
                  <button className="btn danger" onClick={() => remove(s.id)}>
                    {t('common.delete')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel">
        <h2>{t('sources.addTitle')}</h2>
        <form onSubmit={submit} className="form">
          <label>
            {t('sources.form.name')}
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </label>
          <label>
            {t('sources.form.platform')}
            <select
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value as CreateSourceInput['kind'];
                set('kind', kind);
                set('baseUrl', kind === 'github' ? 'https://github.com' : 'https://gitlab.com');
              }}
            >
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
            <input
              value={form.scope.owner}
              onChange={(e) => set('scope', { ...form.scope, owner: e.target.value })}
              required
            />
          </label>
          <label>
            {t('sources.form.auth')}
            <select
              value={form.authKind}
              onChange={(e) => set('authKind', e.target.value as CreateSourceInput['authKind'])}
            >
              <option value="token">{t('sources.form.authToken')}</option>
              <option value="app">{t('sources.form.authApp')}</option>
            </select>
          </label>
          <label>
            {t('sources.form.secret')}{' '}
            <span className="hint">{t('sources.form.secretHint')}</span>
            <input
              type="password"
              value={form.secret}
              onChange={(e) => set('secret', e.target.value)}
              required
              autoComplete="off"
            />
          </label>
          {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
          <button className="btn primary" disabled={busy} type="submit">
            {busy ? t('sources.form.submitting') : t('sources.form.submit')}
          </button>
        </form>
      </section>
    </div>
  );
}
