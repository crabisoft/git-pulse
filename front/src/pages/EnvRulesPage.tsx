import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvRulePublic, ClassifiedEnvironment } from '@repo/shared';
import { api, apiErrorInfo, type CreateEnvRuleInput } from '../api';
import { DeleteIcon, EditIcon, PlusIcon, TestIcon } from '../icons';
import { IconButton } from '../IconButton';
import { ConfirmDialog, Modal } from '../Modal';

const EMPTY: CreateEnvRuleInput = { name: '', pattern: '', kind: 'simple', priority: 100 };

export function EnvRulesPage({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<EnvRulePublic[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** Open editor: `null` rule means creation. */
  const [editing, setEditing] = useState<{ rule: EnvRulePublic | null } | null>(null);
  /** Open tester: `null` rule tests the whole saved rule set. */
  const [testing, setTesting] = useState<{ rule: EnvRulePublic | null } | null>(null);
  const [deleting, setDeleting] = useState<EnvRulePublic | null>(null);

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
    setMsg(null);
  }, [load]);

  async function remove(rule: EnvRulePublic) {
    setDeleting(null);
    try {
      await api.deleteEnvRule(rule.id);
      setMsg({ kind: 'ok', text: t('envRules.deleted') });
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  async function saved(created: boolean) {
    setEditing(null);
    setMsg({ kind: 'ok', text: created ? t('envRules.added') : t('envRules.updated') });
    await load();
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('envRules.listTitle')}</h2>
          <div className="panel-head-actions">
            <button className="btn" onClick={() => setTesting({ rule: null })}>
              {t('envRules.testAll')}
            </button>
            <button className="btn primary with-icon" onClick={() => setEditing({ rule: null })}>
              <PlusIcon /> {t('envRules.addTitle')}
            </button>
          </div>
        </div>

        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
        {rules.length === 0 && <p className="muted">{t('envRules.listEmpty')}</p>}

        <ul className="source-list">
          {rules.map((r) => (
            <li key={r.id} className="source-row">
              <div>
                <div className="source-name">
                  {r.name}{' '}
                  <span className={`rule-kind ${r.kind}`}>{t(`envRules.kind.${r.kind}`)}</span>
                </div>
                <div className="source-meta">
                  <code>{r.pattern}</code> · {t('envRules.form.priority')} {r.priority}
                </div>
              </div>
              <div className="row-actions">
                <IconButton label={t('common.edit')} onClick={() => setEditing({ rule: r })}>
                  <EditIcon />
                </IconButton>
                <IconButton label={t('envRules.testRule')} onClick={() => setTesting({ rule: r })}>
                  <TestIcon />
                </IconButton>
                <IconButton label={t('common.delete')} tone="danger" onClick={() => setDeleting(r)}>
                  <DeleteIcon />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {editing && (
        <EnvRuleDialog
          sourceId={sourceId}
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}

      {testing && (
        <EnvRuleTestDialog
          sourceId={sourceId}
          rule={testing.rule}
          onClose={() => setTesting(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('envRules.deleteTitle')}
          message={t('envRules.confirmDelete', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** Create/edit form, in a modal. `rule` null means creation. */
function EnvRuleDialog({
  sourceId,
  rule,
  onClose,
  onSaved,
}: {
  sourceId: string;
  rule: EnvRulePublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateEnvRuleInput>(
    rule ? { name: rule.name, pattern: rule.pattern, kind: rule.kind, priority: rule.priority } : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateEnvRuleInput>(k: K, v: CreateEnvRuleInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (rule) await api.updateEnvRule(rule.id, form);
      else await api.createEnvRule(sourceId, form);
      await onSaved(!rule);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const title = rule ? t('envRules.editTitle', { name: rule.name }) : t('envRules.addTitle');

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
          <button className="btn primary" disabled={busy} type="submit" form="env-rule-form">
            {busy ? t('envRules.form.submitting') : rule ? t('common.save') : t('envRules.form.submit')}
          </button>
        </>
      }
    >
      <form id="env-rule-form" onSubmit={submit} className="form">
        <label>
          {t('envRules.form.name')}
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        </label>
        <label>
          {t('envRules.form.pattern')} <span className="hint">{t('envRules.form.patternHint')}</span>
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
          {t('envRules.form.priority')} <span className="hint">{t('envRules.form.priorityHint')}</span>
          <input
            type="number"
            min={0}
            value={form.priority ?? 100}
            onChange={(e) => set('priority', Number(e.target.value))}
          />
        </label>
        {error && <div className="banner error">{error}</div>}
      </form>
    </Modal>
  );
}

/**
 * Classifies a sample name — against the single `rule` when given (stateless
 * preview, so unsaved rules can be checked too), otherwise against every saved
 * rule of the source.
 */
function EnvRuleTestDialog({
  sourceId,
  rule,
  onClose,
}: {
  sourceId: string;
  rule: EnvRulePublic | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [sample, setSample] = useState('');
  const [result, setResult] = useState<ClassifiedEnvironment | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function classify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setResult(
        rule
          ? await api.previewEnvRules(sample, [
              { name: rule.name, pattern: rule.pattern, kind: rule.kind, priority: rule.priority },
            ])
          : await api.classifyEnv(sourceId, sample),
      );
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setResult(null);
    }
  }

  const title = rule ? t('envRules.preview.ruleTitle', { name: rule.name }) : t('envRules.preview.title');
  const attributes = result ? Object.entries(result.attributes) : [];

  return (
    <Modal title={title} label={title} onClose={onClose}>
      <p className="muted">{rule ? t('envRules.preview.ruleHint') : t('envRules.preview.hint')}</p>
      {rule && (
        <p className="source-meta">
          <code>{rule.pattern}</code>
        </p>
      )}

      <form className="preview-row" onSubmit={classify}>
        <input
          className="mono-input"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder={t('envRules.preview.placeholder')}
          spellCheck={false}
          autoFocus
        />
        <button className="btn primary" type="submit" disabled={!sample}>
          {t('envRules.preview.classify')}
        </button>
      </form>

      {error && <div className="banner error">{error}</div>}

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
    </Modal>
  );
}
