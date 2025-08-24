import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvRulePublic, ClassifiedEnvironment } from '@repo/shared';
import { api, apiErrorInfo, type CreateEnvRuleInput } from '../api';

const EMPTY: CreateEnvRuleInput = { name: '', pattern: '', kind: 'simple', priority: 100 };

export function EnvRulesPage({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<EnvRulePublic[]>([]);
  const [form, setForm] = useState<CreateEnvRuleInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [sample, setSample] = useState('');
  const [result, setResult] = useState<ClassifiedEnvironment | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRules(await api.listEnvRules(sourceId));
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }, [sourceId, t]);

  useEffect(() => {
    void load();
    setResult(null);
    setSample('');
  }, [load]);

  const set = <K extends keyof CreateEnvRuleInput>(k: K, v: CreateEnvRuleInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.createEnvRule(sourceId, form);
      setForm(EMPTY);
      setMsg({ kind: 'ok', text: t('envRules.added') });
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteEnvRule(id);
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  async function classify() {
    setTestError(null);
    try {
      setResult(await api.classifyEnv(sourceId, sample));
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setTestError(t(code, params));
    }
  }

  const attributes = result ? Object.entries(result.attributes) : [];

  return (
    <div className="grid-2">
      <section className="panel">
        <h2>{t('envRules.listTitle')}</h2>
        {rules.length === 0 && <p className="muted">{t('envRules.listEmpty')}</p>}
        <ul className="source-list">
          {rules.map((r) => (
            <li key={r.id} className="source-row">
              <div>
                <div className="source-name">
                  {r.name} <span className={`rule-kind ${r.kind}`}>{t(`envRules.kind.${r.kind}`)}</span>
                </div>
                <div className="source-meta">
                  <code>{r.pattern}</code> · {t('envRules.form.priority')} {r.priority}
                </div>
              </div>
              <div className="row-actions">
                <button className="btn danger" onClick={() => remove(r.id)}>
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>

        <h3 style={{ marginTop: '1.4rem' }}>{t('envRules.addTitle')}</h3>
        <form onSubmit={submit} className="form">
          <label>
            {t('envRules.form.name')}
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </label>
          <label>
            {t('envRules.form.pattern')}{' '}
            <span className="hint">{t('envRules.form.patternHint')}</span>
            <input
              className="mono-input"
              value={form.pattern}
              onChange={(e) => set('pattern', e.target.value)}
              required
              spellCheck={false}
            />
          </label>
          <label>
            {t('envRules.form.kind')}
            <select
              value={form.kind}
              onChange={(e) => set('kind', e.target.value as CreateEnvRuleInput['kind'])}
            >
              <option value="simple">{t('envRules.kind.simple')}</option>
              <option value="meta">{t('envRules.kind.meta')}</option>
            </select>
          </label>
          <label>
            {t('envRules.form.priority')}{' '}
            <span className="hint">{t('envRules.form.priorityHint')}</span>
            <input
              type="number"
              min={0}
              value={form.priority ?? 100}
              onChange={(e) => set('priority', Number(e.target.value))}
            />
          </label>
          {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
          <button className="btn primary" disabled={busy} type="submit">
            {busy ? t('envRules.form.submitting') : t('envRules.form.submit')}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>{t('envRules.preview.title')}</h2>
        <p className="muted">{t('envRules.preview.hint')}</p>
        <div className="preview-row">
          <input
            className="mono-input"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder={t('envRules.preview.placeholder')}
            spellCheck={false}
          />
          <button className="btn primary" onClick={classify} disabled={!sample}>
            {t('envRules.preview.classify')}
          </button>
        </div>

        {testError && <div className="banner error">{testError}</div>}

        {result && (
          <div className="classify-result">
            <div className="cr-block">
              <div className="cr-label">{t('envRules.preview.attributes')}</div>
              {attributes.length === 0 ? (
                <span className="muted">{t('envRules.preview.none')}</span>
              ) : (
                <div className="pills">
                  {attributes.map(([k, v]) => (
                    <span key={k} className="pill attr">
                      <b>{k}</b>={v}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="cr-block">
              <div className="cr-label">{t('envRules.preview.metaEnvironments')}</div>
              {result.metaEnvironments.length === 0 ? (
                <span className="muted">{t('envRules.preview.none')}</span>
              ) : (
                <div className="pills">
                  {result.metaEnvironments.map((m) => (
                    <span key={m} className="pill meta">
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
