import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type {
  EnvRulePublic,
  ClassifiedEnvironment,
  PageInfo,
  RuleTarget,
  SourcePublic,
} from '@repo/shared';
import { api, apiErrorInfo, type CreateEnvRuleInput, type PageQuery } from '../api';
import { DeleteIcon, EditIcon, PlusIcon, TestIcon } from '../icons';
import { IconButton } from '../IconButton';
import { ConfirmDialog, Modal } from '../Modal';
import { Pagination } from '../Pagination';

const EMPTY: CreateEnvRuleInput = {
  name: '',
  pattern: '',
  kind: 'simple',
  priority: 100,
  repo: '',
};

/** A forced attribute being edited: a list, so a half-typed key keeps its row. */
type AttributeRow = { key: string; value: string };

/** Module constant so resetting on source change never re-triggers a fetch. */
const FIRST_PAGE: PageQuery = {};

const TARGETS: RuleTarget[] = ['environment', 'repository', 'incident'];

export function EnvRulesPage() {
  const { t } = useTranslation();
  // Rules are edited one target at a time: environment names on one side, repo
  // names on the other. They never mix, so the tab drives every request — and
  // it lives in the query string so a tab is a shareable URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('target');
  const target: RuleTarget = isTarget(requested) ? requested : 'environment';
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
  /** For the tester: what a source really answers is what production answers. */
  const [sources, setSources] = useState<SourcePublic[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await api.listEnvRules(target, page);
      setRules(result.items);
      setPageInfo(result.page);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }, [target, page, t]);

  useEffect(() => {
    void load();
    setMsg(null);
  }, [load]);

  // Back to the first page when switching target.
  useEffect(() => {
    setPage(FIRST_PAGE);
  }, [target]);

  // Read once, for the tester alone: a failure there costs it its source list
  // and nothing else, so it is not worth a banner over the catalogue.
  useEffect(() => {
    void api
      .listSources()
      .then((found) => setSources(found.items))
      .catch(() => setSources([]));
  }, []);

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
        <p className="muted subtabs-hint">
          {t('envRules.catalogueHint')} {t(`envRules.target.${target}.hint`)}
        </p>

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
                  {r.repo && (
                    <>
                      {' · '}
                      {t('envRules.form.repo')} <code>{r.repo}</code>
                    </>
                  )}
                </div>
                {Object.keys(forced(r)).length > 0 && (
                  <div className="pills rule-attrs">
                    {Object.entries(forced(r)).map(([k, v]) => (
                      <span key={k} className="pill attr">
                        <b>{k}</b>={v}
                      </span>
                    ))}
                  </div>
                )}
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
          target={target}
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}

      {testing && (
        <EnvRuleTestDialog
          target={target}
          rule={testing.rule}
          rules={rules}
          sources={sources}
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

/**
 * The forced attributes of a rule. The field is part of the contract, but a
 * page is only ever as fresh as the server answering it: a back that predates
 * it sends rules without one, and a missing map is not worth a blank screen.
 */
function forced(rule: EnvRulePublic): Record<string, string> {
  return rule.attributes ?? {};
}

/** Narrows the query-string value; anything else falls back to the default tab. */
function isTarget(value: string | null): value is RuleTarget {
  return value !== null && (TARGETS as string[]).includes(value);
}

/** Create/edit form, in a modal. `rule` null means creation. */
function EnvRuleDialog({
  target,
  rule,
  onClose,
  onSaved,
}: {
  target: RuleTarget;
  rule: EnvRulePublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  // A rule belongs to the tab it was created from; there is no target picker.
  const [form, setForm] = useState<CreateEnvRuleInput>(
    rule
      ? {
          name: rule.name,
          pattern: rule.pattern,
          kind: rule.kind,
          priority: rule.priority,
          repo: rule.repo ?? '',
          target,
        }
      : { ...EMPTY, target },
  );
  const [attributes, setAttributes] = useState<AttributeRow[]>(
    Object.entries(rule?.attributes ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateEnvRuleInput>(k: K, v: CreateEnvRuleInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const setRow = (index: number, patch: Partial<AttributeRow>) =>
    setAttributes((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Sent in full, so clearing a row clears the stored attribute. A meta rule
    // ignores them, so it never carries any.
    const payload: CreateEnvRuleInput = {
      ...form,
      attributes:
        form.kind === 'simple'
          ? Object.fromEntries(
              attributes
                .map(({ key, value }) => [key.trim(), value.trim()] as const)
                .filter(([key, value]) => key !== '' && value !== ''),
            )
          : {},
    };
    try {
      if (rule) await api.updateEnvRule(rule.id, payload);
      else await api.createEnvRule(payload);
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
        <label>
          {t('envRules.form.repo')} <span className="hint">{t('envRules.form.repoHint')}</span>
          <input
            className="mono-input"
            value={form.repo ?? ''}
            onChange={(e) => set('repo', e.target.value)}
            placeholder={t('envRules.form.repoPlaceholder')}
            spellCheck={false}
          />
        </label>
        {/* Only a simple rule carries attributes: a meta rule contributes its name. */}
        {form.kind === 'simple' && (
          <div className="attr-editor">
            <span className="attr-editor-label">
              {t('envRules.form.attributes')}{' '}
              <span className="hint">{t('envRules.form.attributesHint')}</span>
            </span>
            {attributes.map((row, i) => (
              <div className="attr-row" key={i}>
                <input
                  className="mono-input"
                  value={row.key}
                  placeholder={t('envRules.form.attributeKey')}
                  onChange={(e) => setRow(i, { key: e.target.value })}
                  spellCheck={false}
                  aria-label={t('envRules.form.attributeKey')}
                />
                <input
                  className="mono-input"
                  value={row.value}
                  placeholder={t('envRules.form.attributeValue')}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                  spellCheck={false}
                  aria-label={t('envRules.form.attributeValue')}
                />
                <IconButton
                  label={t('common.delete')}
                  tone="danger"
                  onClick={() => setAttributes((rows) => rows.filter((_, at) => at !== i))}
                >
                  <DeleteIcon />
                </IconButton>
              </div>
            ))}
            <button
              type="button"
              className="btn with-icon"
              onClick={() => setAttributes((rows) => [...rows, { key: '', value: '' }])}
            >
              <PlusIcon /> {t('envRules.form.addAttribute')}
            </button>
          </div>
        )}
        {error && <div className="banner error">{error}</div>}
      </form>
    </Modal>
  );
}

/**
 * Classifies a sample name, one of two ways.
 *
 * Against the **catalogue** — the rules listed here, sent inline — a rule can
 * be tried before anything else is set up, including one nobody uses yet.
 * Against a **source**, the answer is the one production gives: its own
 * subscribed rules, and its own repo names offered rather than typed. The two
 * differ exactly where a rule is written but never enabled, or confined to a
 * repo whose name is not quite what it was thought to be — which is why the
 * second is here at all.
 */
function EnvRuleTestDialog({
  target,
  rule,
  rules,
  sources,
  onClose,
}: {
  target: RuleTarget;
  rule: EnvRulePublic | null;
  /** The listed catalogue, used when testing the whole set. */
  rules: EnvRulePublic[];
  sources: SourcePublic[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [sample, setSample] = useState('');
  /** Empty means the catalogue: the stateless preview, as before. */
  const [sourceId, setSourceId] = useState('');
  /** Left empty on purpose tests the other case: the repo unknown. */
  const [repo, setRepo] = useState('');
  const [repos, setRepos] = useState<string[]>([]);
  const [result, setResult] = useState<ClassifiedEnvironment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tested = rule ? [rule] : rules;
  /** Whether anything under test would answer differently for another repo. */
  const repoScoped = tested.some((r) => r.repo);

  // The source's own repo names, so the field offers the strings the rules are
  // actually matched against instead of what one believes them to be — a
  // GitLab repo carries its whole namespace, and an anchored pattern misses it.
  useEffect(() => {
    if (!sourceId) return setRepos([]);
    let live = true;
    void api
      .sourceRepositories(sourceId)
      .then((found) => live && setRepos(found.map((r) => r.name)))
      .catch(() => live && setRepos([]));
    return () => {
      live = false;
    };
  }, [sourceId]);

  async function classify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setResult(
        sourceId
          ? // What the source will really answer: the rules it subscribed to,
            // not the ones on screen.
            await api.classifyEnv(sourceId, sample, target, repo || undefined)
          : await api.previewEnvRules(
              sample,
              tested.map((r) => ({
                name: r.name,
                pattern: r.pattern,
                kind: r.kind,
                priority: r.priority,
                attributes: forced(r),
                repo: r.repo ?? '',
              })),
              repo || undefined,
            ),
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

      {sources.length > 0 && (
        <label className="preview-against">
          {t('envRules.preview.against')}
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">{t('envRules.preview.againstCatalogue')}</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
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
        {/* Only where a rule is confined to a repo does naming one change the
            answer; elsewhere the field would be a question about nothing. */}
        {(repoScoped || sourceId) && (
          <>
            <input
              className="mono-input"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder={t('envRules.preview.repoPlaceholder')}
              aria-label={t('envRules.form.repo')}
              list={repos.length > 0 ? 'preview-repos' : undefined}
              spellCheck={false}
            />
            {repos.length > 0 && (
              <datalist id="preview-repos">
                {repos.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </>
        )}
        <button className="btn primary" type="submit" disabled={!sample}>
          {t('envRules.preview.classify')}
        </button>
      </form>
      {sourceId ? (
        <p className="hint">{t('envRules.preview.againstSourceHint')}</p>
      ) : (
        repoScoped && !repo && <p className="hint">{t('envRules.preview.noRepoHint')}</p>
      )}

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
