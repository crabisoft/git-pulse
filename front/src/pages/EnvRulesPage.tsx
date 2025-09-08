import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { EnvRulePublic, ClassifiedEnvironment, PageInfo, RuleTarget } from '@repo/shared';
import { api, apiErrorInfo, type CreateEnvRuleInput, type PageQuery } from '../api';
import { DeleteIcon, EditIcon, PlusIcon, TestIcon } from '../icons';
import { IconButton } from '../IconButton';
import { ConfirmDialog, Modal } from '../Modal';
import { Pagination } from '../Pagination';

const EMPTY: CreateEnvRuleInput = { name: '', pattern: '', kind: 'simple', priority: 100 };

/** Module constant so resetting on source change never re-triggers a fetch. */
const FIRST_PAGE: PageQuery = {};

const TARGETS: RuleTarget[] = ['environment', 'repository'];

export function EnvRulesPage({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  // Rules are edited one target at a time: environment names on one side, repo
  // names on the other. They never mix, so the tab drives every request — and
  // it lives in the query string so a tab is a shareable URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const target: RuleTarget = searchParams.get('target') === 'repository' ? 'repository' : 'environment';
  // The default target stays implicit, so the plain URL keeps working.
  const setTarget = (next: RuleTarget) =>
    setSearchParams(next === 'environment' ? {} : { target: next });
  const [rules, setRules] = useState<EnvRulePublic[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [page, setPage] = useState<PageQuery>(FIRST_PAGE);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** Open editor: `null` rule means creation. */
  const [editing, setEditing] = useState<{ rule: EnvRulePublic | null } | null>(null);
  /** Open tester: `null` rule tests the whole saved rule set. */
  const [testing, setTesting] = useState<{ rule: EnvRulePublic | null } | null>(null);
  const [deleting, setDeleting] = useState<EnvRulePublic | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.listEnvRules(sourceId, target, page);
      setRules(result.items);
      setPageInfo(result.page);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }, [sourceId, target, page, t]);

  useEffect(() => {
    void load();
    setMsg(null);
  }, [load]);

  // Back to the first page when switching source or target.
  useEffect(() => {
    setPage(FIRST_PAGE);
  }, [sourceId, target]);

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
          <h2>{t(`envRules.target.${target}.listTitle`)}</h2>
          <div className="panel-head-actions">
            <button className="btn" onClick={() => setTesting({ rule: null })}>
              {t('envRules.testAll')}
            </button>
            <button className="btn primary with-icon" onClick={() => setEditing({ rule: null })}>
              <PlusIcon /> {t('envRules.addTitle')}
            </button>
          </div>
        </div>

        <div className="subtabs" role="tablist">
          {TARGETS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={target === value}
              className={target === value ? 'subtab active' : 'subtab'}
              onClick={() => setTarget(value)}
            >
              {t(`envRules.target.${value}.tab`)}
            </button>
          ))}
        </div>
        <p className="muted subtabs-hint">{t(`envRules.target.${target}.hint`)}</p>

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

        {pageInfo && (
          <Pagination info={pageInfo} value={page} onChange={setPage} />
        )}
      </section>

      {editing && (
        <EnvRuleDialog
          sourceId={sourceId}
          target={target}
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}

      {testing && (
        <EnvRuleTestDialog
          sourceId={sourceId}
          target={target}
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
  target,
  rule,
  onClose,
  onSaved,
}: {
  sourceId: string;
  target: RuleTarget;
  rule: EnvRulePublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  // A rule belongs to the tab it was created from; there is no target picker.
  const [form, setForm] = useState<CreateEnvRuleInput>(
    rule
      ? { name: rule.name, pattern: rule.pattern, kind: rule.kind, priority: rule.priority, target }
      : { ...EMPTY, target },
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
  target,
  rule,
  onClose,
}: {
  sourceId: string;
  target: RuleTarget;
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
          : await api.classifyEnv(sourceId, sample, target),
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
          placeholder={t(`envRules.target.${target}.placeholder`)}
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
