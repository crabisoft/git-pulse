import { useState } from 'react';
import type { SourcePublic } from '@repo/shared';
import { api, type CreateSourceInput } from '../api';

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
  const [form, setForm] = useState<CreateSourceInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});

  const set = <K extends keyof CreateSourceInput>(k: K, v: CreateSourceInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.createSource(form);
      setForm(EMPTY);
      setMsg({ kind: 'ok', text: 'Source ajoutée.' });
      await onChange();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setTested((t) => ({ ...t, [id]: '…' }));
    try {
      const r = await api.testSource(id);
      setTested((t) => ({ ...t, [id]: (r.ok ? '✓ ' : '✗ ') + r.message }));
    } catch (err) {
      setTested((t) => ({ ...t, [id]: '✗ ' + (err instanceof Error ? err.message : String(err)) }));
    }
  }

  async function remove(id: string) {
    await api.deleteSource(id);
    await onChange();
  }

  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Sources configurées</h2>
        {sources.length === 0 && <p className="muted">Aucune source pour l'instant.</p>}
        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.id} className="source-row">
              <div>
                <div className="source-name">
                  {s.name} <span className={`kind-badge ${s.kind}`}>{s.kind}</span>
                </div>
                <div className="source-meta">
                  {s.baseUrl} · {s.scope.owner} · auth: {s.authKind}
                </div>
                {tested[s.id] && <div className="source-test">{tested[s.id]}</div>}
              </div>
              <div className="row-actions">
                <button className="btn" onClick={() => test(s.id)}>
                  Tester
                </button>
                <button className="btn danger" onClick={() => remove(s.id)}>
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Ajouter une source</h2>
        <form onSubmit={submit} className="form">
          <label>
            Nom
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </label>
          <label>
            Plateforme
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
            URL de base <span className="hint">(self-hosted / Enterprise supporté)</span>
            <input value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} required />
          </label>
          <label>
            {form.kind === 'github' ? 'Organisation' : 'Groupe'}
            <input
              value={form.scope.owner}
              onChange={(e) => set('scope', { ...form.scope, owner: e.target.value })}
              required
            />
          </label>
          <label>
            Authentification
            <select
              value={form.authKind}
              onChange={(e) => set('authKind', e.target.value as CreateSourceInput['authKind'])}
            >
              <option value="token">Token partagé</option>
              <option value="app">App (OAuth / GitHub App)</option>
            </select>
          </label>
          <label>
            Secret <span className="hint">(chiffré au repos, jamais réaffiché)</span>
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
            {busy ? 'Ajout…' : 'Ajouter la source'}
          </button>
        </form>
      </section>
    </div>
  );
}
