import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EnvUrlMode,
  EnvUrlRulePublic,
  ManualEnvironmentPublic,
  PageInfo,
  SourcePublic,
} from '@repo/shared';
import {
  api,
  apiErrorInfo,
  type CreateEnvUrlRuleInput,
  type CreateManualEnvironmentInput,
  type EnvUrlPreview,
  type PageQuery,
} from '../api';
import { DeleteIcon, EditIcon, PlusIcon, TestIcon } from '../icons';
import { IconButton } from '../IconButton';
import { ConfirmDialog, Modal } from '../Modal';
import { Pagination } from '../Pagination';

const EMPTY_RULE: CreateEnvUrlRuleInput = {
  name: '',
  pattern: '',
  repo: '',
  urlTemplate: '',
  mode: 'fill',
  priority: 100,
};

const EMPTY_ENVIRONMENT: CreateManualEnvironmentInput = {
  environment: '',
  repo: '',
  url: '',
  mode: 'fill',
};

const MODES: EnvUrlMode[] = ['fill', 'overwrite'];

/** A forced attribute being edited: a list, so a half-typed key keeps its row. */
type AttributeRow = { key: string; value: string };

/** Module constant so resetting on source change never re-triggers a fetch. */
const FIRST_PAGE: PageQuery = {};

type Message = { kind: 'ok' | 'err'; text: string } | null;

/**
 * Where environments answer: the rules that derive an address from a name, and
 * the environments somebody wrote down.
 *
 * Both on one page because they answer one question between them, and the
 * answer is decided by the two together — a declaration is the last word, the
 * rules cover everything nobody wrote down.
 */
export function EnvUrlsPage({ sources }: { sources: SourcePublic[] }) {
  return (
    <>
      <RulesPanel sources={sources} />
      <DeclaredPanel sources={sources} />
    </>
  );
}

function RulesPanel({ sources }: { sources: SourcePublic[] }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<EnvUrlRulePublic[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [page, setPage] = useState<PageQuery>(FIRST_PAGE);
  const [msg, setMsg] = useState<Message>(null);
  /** Open editor: `null` rule means creation. */
  const [editing, setEditing] = useState<{ rule: EnvUrlRulePublic | null } | null>(null);
  /** Open tester: `null` rule tries the whole saved set. */
  const [testing, setTesting] = useState<{ rule: EnvUrlRulePublic | null } | null>(null);
  const [deleting, setDeleting] = useState<EnvUrlRulePublic | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.listEnvUrlRules(page);
      setRules(result.items);
      setPageInfo(result.page);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }, [page, t]);

  useEffect(() => {
    void load();
    setMsg(null);
  }, [load]);

  async function remove(rule: EnvUrlRulePublic) {
    setDeleting(null);
    try {
      await api.deleteEnvUrlRule(rule.id);
      setMsg({ kind: 'ok', text: t('envUrls.rules.deleted') });
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('envUrls.rules.listTitle')}</h2>
          <div className="panel-head-actions">
            <button className="btn" onClick={() => setTesting({ rule: null })}>
              {t('envUrls.rules.testAll')}
            </button>
            <button className="btn primary with-icon" onClick={() => setEditing({ rule: null })}>
              <PlusIcon /> {t('envUrls.rules.addTitle')}
            </button>
          </div>
        </div>
        <p className="muted subtabs-hint">{t('envUrls.rules.catalogueHint')}</p>

        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
        {rules.length === 0 && <p className="muted">{t('envUrls.rules.listEmpty')}</p>}

        <ul className="source-list">
          {rules.map((r) => (
            <li key={r.id} className="source-row">
              <div>
                <div className="source-name">
                  {r.name} <span className={`rule-kind ${r.mode}`}>{t(`envUrls.mode.${r.mode}`)}</span>
                </div>
                <div className="source-meta">
                  <code>{r.pattern}</code> → <code>{r.urlTemplate}</code>
                </div>
                <div className="source-meta">
                  {t('envUrls.rules.form.priority')} {r.priority}
                  {r.repo && (
                    <>
                      {' · '}
                      {t('envUrls.rules.form.repo')} <code>{r.repo}</code>
                    </>
                  )}
                </div>
              </div>
              <div className="row-actions">
                <IconButton label={t('common.edit')} onClick={() => setEditing({ rule: r })}>
                  <EditIcon />
                </IconButton>
                <IconButton
                  label={t('envUrls.rules.testRule')}
                  onClick={() => setTesting({ rule: r })}
                >
                  <TestIcon />
                </IconButton>
                <IconButton label={t('common.delete')} tone="danger" onClick={() => setDeleting(r)}>
                  <DeleteIcon />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>

        {pageInfo && <Pagination info={pageInfo} value={page} onChange={setPage} />}
      </section>

      {editing && (
        <EnvUrlRuleDialog
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={async (created) => {
            setEditing(null);
            setMsg({
              kind: 'ok',
              text: created ? t('envUrls.rules.added') : t('envUrls.rules.updated'),
            });
            await load();
          }}
        />
      )}

      {testing && (
        <EnvUrlTestDialog
          rules={testing.rule ? [testing.rule] : rules}
          sources={sources}
          onClose={() => setTesting(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('envUrls.rules.deleteTitle')}
          message={t('envUrls.rules.confirmDelete', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** Create/edit form for an address rule. `rule` null means creation. */
function EnvUrlRuleDialog({
  rule,
  onClose,
  onSaved,
}: {
  rule: EnvUrlRulePublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateEnvUrlRuleInput>(
    rule
      ? {
          name: rule.name,
          pattern: rule.pattern,
          repo: rule.repo ?? '',
          urlTemplate: rule.urlTemplate,
          mode: rule.mode,
          priority: rule.priority,
        }
      : EMPTY_RULE,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateEnvUrlRuleInput>(k: K, v: CreateEnvUrlRuleInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (rule) await api.updateEnvUrlRule(rule.id, form);
      else await api.createEnvUrlRule(form);
      await onSaved(!rule);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const title = rule
    ? t('envUrls.rules.editTitle', { name: rule.name })
    : t('envUrls.rules.addTitle');

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
          <button className="btn primary" disabled={busy} type="submit" form="env-url-rule-form">
            {busy ? t('envUrls.rules.form.submitting') : rule ? t('common.save') : t('envUrls.rules.form.submit')}
          </button>
        </>
      }
    >
      <form id="env-url-rule-form" onSubmit={submit} className="form">
        {error && <div className="banner error">{error}</div>}
        <label>
          {t('envUrls.rules.form.name')}
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          {t('envUrls.rules.form.pattern')}{' '}
          <span className="hint">{t('envUrls.rules.form.patternHint')}</span>
          <input
            className="mono-input"
            value={form.pattern}
            onChange={(e) => set('pattern', e.target.value)}
            required
            spellCheck={false}
          />
        </label>
        <label>
          {t('envUrls.rules.form.urlTemplate')}{' '}
          <span className="hint">{t('envUrls.rules.form.urlTemplateHint')}</span>
          <input
            className="mono-input"
            value={form.urlTemplate}
            onChange={(e) => set('urlTemplate', e.target.value)}
            placeholder={t('envUrls.rules.form.urlTemplatePlaceholder')}
            required
            spellCheck={false}
          />
        </label>
        <ModeField value={form.mode ?? 'fill'} onChange={(mode) => set('mode', mode)} />
        <label>
          {t('envUrls.rules.form.priority')}{' '}
          <span className="hint">{t('envUrls.rules.form.priorityHint')}</span>
          <input
            type="number"
            min={0}
            value={form.priority ?? 100}
            onChange={(e) => set('priority', Number(e.target.value))}
          />
        </label>
        <label>
          {t('envUrls.rules.form.repo')}{' '}
          <span className="hint">{t('envUrls.rules.form.repoHint')}</span>
          <input
            className="mono-input"
            value={form.repo ?? ''}
            onChange={(e) => set('repo', e.target.value)}
            spellCheck={false}
          />
        </label>
      </form>
    </Modal>
  );
}

/** The fill/overwrite choice, spelled out — it is the field people get wrong. */
function ModeField({
  value,
  onChange,
}: {
  value: EnvUrlMode;
  onChange: (mode: EnvUrlMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <label>
      {t('envUrls.rules.form.mode')}
      <select value={value} onChange={(e) => onChange(e.target.value as EnvUrlMode)}>
        {MODES.map((mode) => (
          <option key={mode} value={mode}>
            {t(`envUrls.mode.${mode}`)}
          </option>
        ))}
      </select>
      <span className="hint">{t(`envUrls.modeHint.${value}`)}</span>
    </label>
  );
}

/**
 * Tries a rule set against one environment without saving anything.
 *
 * The published address is a field of the test on purpose: it decides the
 * answer as much as the rules do, and a rule that fills is silent in its
 * presence — which is the thing an author has no other way of seeing.
 */
function EnvUrlTestDialog({
  rules,
  sources,
  onClose,
}: {
  rules: EnvUrlRulePublic[];
  sources: SourcePublic[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [environment, setEnvironment] = useState('');
  const [repo, setRepo] = useState('');
  const [published, setPublished] = useState('');
  const [result, setResult] = useState<EnvUrlPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Only ever decides which repo names are offered: the preview is stateless. */
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [repos, setRepos] = useState<string[]>([]);

  /** Whether naming a repo changes the answer at all. */
  const repoScoped = rules.some((rule) => rule.repo);

  // The source's own repo names, so the field offers the strings the rules are
  // really matched against rather than what one believes them to be — a GitLab
  // repo carries its whole namespace, and a pattern written against the bare
  // name never matches.
  useEffect(() => {
    if (!sourceId || !repoScoped) return setRepos([]);
    let live = true;
    void api
      .sourceRepositories(sourceId)
      .then((found) => live && setRepos(found.map((r) => r.name)))
      .catch(() => live && setRepos([]));
    return () => {
      live = false;
    };
  }, [sourceId, repoScoped]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.previewEnvUrl({
          environment,
          repo: repo || undefined,
          environmentUrl: published || undefined,
          rules: rules.map((r) => ({
            name: r.name,
            pattern: r.pattern,
            repo: r.repo ?? undefined,
            urlTemplate: r.urlTemplate,
            mode: r.mode,
            priority: r.priority,
          })),
        }),
      );
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('envUrls.rules.testTitle')}
      label={t('envUrls.rules.testTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button className="btn primary" disabled={busy} type="submit" form="env-url-test-form">
            {busy ? t('envUrls.rules.testing') : t('envUrls.rules.test.run')}
          </button>
        </>
      }
    >
      <form id="env-url-test-form" onSubmit={run} className="form">
        {error && <div className="banner error">{error}</div>}
        <label>
          {t('envUrls.rules.test.environment')}
          <input
            className="mono-input"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            required
            autoFocus
            spellCheck={false}
          />
        </label>
        {/* Only where a rule is confined to a repo does naming one change the
            answer; elsewhere both fields would be questions about nothing. */}
        {repoScoped && sources.length > 1 && (
          <label className="inline-field">
            {t('envUrls.declared.source')}{' '}
            <span className="hint">{t('envUrls.rules.test.sourceHint')}</span>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {repoScoped && (
          <>
            <label>
              {t('envUrls.rules.test.repo')}{' '}
              <span className="hint">{t('envUrls.rules.test.repoHint')}</span>
              <input
                className="mono-input"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                list={repos.length > 0 ? 'env-url-test-repos' : undefined}
                spellCheck={false}
              />
              {repos.length > 0 && (
                <datalist id="env-url-test-repos">
                  {repos.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              )}
            </label>
            {/* Outside the label, which would otherwise read it out as part of
                the field's name. This is the failure the dialog used to report
                as "no rule addresses this environment", sending the author back
                to a pattern that was never the problem. */}
            {!repo.trim() && <p className="field-note">{t('envUrls.rules.test.noRepoHint')}</p>}
          </>
        )}
        <label>
          {t('envUrls.rules.test.published')}{' '}
          <span className="hint">{t('envUrls.rules.test.publishedHint')}</span>
          <input
            className="mono-input"
            value={published}
            onChange={(e) => setPublished(e.target.value)}
            spellCheck={false}
          />
        </label>
      </form>

      {result && (
        <div className="preview-result">
          {result.url === null ? (
            result.unresolved ? (
              /* The ordinary mistake, and the one "no rule addresses this
                 environment" used to hide: a pattern capturing
                 `(?<Customer>…)` against a template asking for `{customer}`.
                 Naming the rule and the placeholder ends it in one reading. */
              <p className="field-note">
                {t('envUrls.rules.test.unresolved', {
                  rule: result.rule,
                  placeholder: `{${result.unresolved}}`,
                })}
              </p>
            ) : (
              <p className="muted">{t('envUrls.rules.test.none')}</p>
            )
          ) : (
            <p>
              <code>{result.url}</code>{' '}
              {result.published !== null && result.url === result.published ? (
                <span className="hint">{t('envUrls.rules.test.unchanged')}</span>
              ) : (
                /* Which of them won, which is the question as soon as the set
                   is tried rather than a single rule. */
                result.rule && (
                  <span className="hint">{t('envUrls.rules.test.via', { name: result.rule })}</span>
                )
              )}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** The environments a source declares by hand — one source at a time. */
function DeclaredPanel({ sources }: { sources: SourcePublic[] }) {
  const { t } = useTranslation();
  const [sourceId, setSourceId] = useState<string>('');
  const [environments, setEnvironments] = useState<ManualEnvironmentPublic[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [page, setPage] = useState<PageQuery>(FIRST_PAGE);
  const [msg, setMsg] = useState<Message>(null);
  const [editing, setEditing] = useState<{ entry: ManualEnvironmentPublic | null } | null>(null);
  const [deleting, setDeleting] = useState<ManualEnvironmentPublic | null>(null);

  // The first source, until somebody picks another: a page that opens on
  // "choose a source" is a page that shows nothing on an install with one.
  useEffect(() => {
    if (!sourceId && sources.length > 0) setSourceId(sources[0].id);
  }, [sources, sourceId]);

  const load = useCallback(async () => {
    if (!sourceId) return;
    try {
      const result = await api.listManualEnvironments(sourceId, page);
      setEnvironments(result.items);
      setPageInfo(result.page);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }, [sourceId, page, t]);

  useEffect(() => {
    void load();
    setMsg(null);
  }, [load]);

  useEffect(() => {
    setPage(FIRST_PAGE);
  }, [sourceId]);

  async function remove(entry: ManualEnvironmentPublic) {
    setDeleting(null);
    try {
      await api.deleteManualEnvironment(entry.id);
      setMsg({ kind: 'ok', text: t('envUrls.declared.deleted') });
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('envUrls.declared.listTitle')}</h2>
          <div className="panel-head-actions">
            <button
              className="btn primary with-icon"
              disabled={!sourceId}
              onClick={() => setEditing({ entry: null })}
            >
              <PlusIcon /> {t('envUrls.declared.addTitle')}
            </button>
          </div>
        </div>
        <p className="muted subtabs-hint">{t('envUrls.declared.hint')}</p>

        {sources.length > 1 && (
          <label className="inline-field">
            {t('envUrls.declared.source')}
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
        {sources.length === 0 && <p className="muted">{t('envUrls.declared.noSources')}</p>}
        {sourceId && environments.length === 0 && (
          <p className="muted">{t('envUrls.declared.listEmpty')}</p>
        )}

        <ul className="source-list">
          {environments.map((entry) => (
            <li key={entry.id} className="source-row">
              <div>
                <div className="source-name">
                  {entry.environment}{' '}
                  <span className={`rule-kind ${entry.mode}`}>{t(`envUrls.mode.${entry.mode}`)}</span>
                </div>
                <div className="source-meta">
                  {entry.url ? (
                    <code>{entry.url}</code>
                  ) : (
                    <span className="muted">{t('envUrls.declared.noUrl')}</span>
                  )}
                  {' · '}
                  {entry.repo ? (
                    <>
                      {t('envUrls.declared.form.repo')} <code>{entry.repo}</code>
                    </>
                  ) : (
                    t('envUrls.declared.noRepo')
                  )}
                </div>
                {Object.keys(entry.attributes ?? {}).length > 0 && (
                  <div className="pills rule-attrs">
                    {Object.entries(entry.attributes).map(([k, v]) => (
                      <span key={k} className="pill attr">
                        <b>{k}</b>={v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="row-actions">
                <IconButton label={t('common.edit')} onClick={() => setEditing({ entry })}>
                  <EditIcon />
                </IconButton>
                <IconButton
                  label={t('common.delete')}
                  tone="danger"
                  onClick={() => setDeleting(entry)}
                >
                  <DeleteIcon />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>

        {pageInfo && <Pagination info={pageInfo} value={page} onChange={setPage} />}
      </section>

      {editing && sourceId && (
        <ManualEnvironmentDialog
          sourceId={sourceId}
          entry={editing.entry}
          onClose={() => setEditing(null)}
          onSaved={async (created) => {
            setEditing(null);
            setMsg({
              kind: 'ok',
              text: created ? t('envUrls.declared.added') : t('envUrls.declared.updated'),
            });
            await load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('envUrls.declared.deleteTitle')}
          message={t('envUrls.declared.confirmDelete', { name: deleting.environment })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** Create/edit form for a declared environment. `entry` null means creation. */
function ManualEnvironmentDialog({
  sourceId,
  entry,
  onClose,
  onSaved,
}: {
  sourceId: string;
  entry: ManualEnvironmentPublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateManualEnvironmentInput>(
    entry
      ? {
          environment: entry.environment,
          repo: entry.repo,
          url: entry.url ?? '',
          mode: entry.mode,
        }
      : EMPTY_ENVIRONMENT,
  );
  const [attributes, setAttributes] = useState<AttributeRow[]>(
    Object.entries(entry?.attributes ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateManualEnvironmentInput>(
    k: K,
    v: CreateManualEnvironmentInput[K],
  ) => setForm((f) => ({ ...f, [k]: v }));

  const setRow = (index: number, patch: Partial<AttributeRow>) =>
    setAttributes((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Sent in full, so clearing a row clears the stored attribute.
    const payload: CreateManualEnvironmentInput = {
      ...form,
      attributes: Object.fromEntries(
        attributes
          .map(({ key, value }) => [key.trim(), value.trim()] as const)
          .filter(([key, value]) => key !== '' && value !== ''),
      ),
    };
    try {
      if (entry) await api.updateManualEnvironment(entry.id, payload);
      else await api.createManualEnvironment(sourceId, payload);
      await onSaved(!entry);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const title = entry
    ? t('envUrls.declared.editTitle', { name: entry.environment })
    : t('envUrls.declared.addTitle');

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
          <button className="btn primary" disabled={busy} type="submit" form="manual-env-form">
            {busy
              ? t('envUrls.declared.form.submitting')
              : entry
                ? t('common.save')
                : t('envUrls.declared.form.submit')}
          </button>
        </>
      }
    >
      <form id="manual-env-form" onSubmit={submit} className="form">
        {error && <div className="banner error">{error}</div>}
        <label>
          {t('envUrls.declared.form.environment')}
          <input
            className="mono-input"
            value={form.environment}
            onChange={(e) => set('environment', e.target.value)}
            required
            autoFocus
            spellCheck={false}
          />
        </label>
        <label>
          {t('envUrls.declared.form.repo')}{' '}
          <span className="hint">{t('envUrls.declared.form.repoHint')}</span>
          <input
            className="mono-input"
            value={form.repo ?? ''}
            onChange={(e) => set('repo', e.target.value)}
            spellCheck={false}
          />
        </label>
        <label>
          {t('envUrls.declared.form.url')}{' '}
          <span className="hint">{t('envUrls.declared.form.urlHint')}</span>
          <input
            className="mono-input"
            value={form.url ?? ''}
            onChange={(e) => set('url', e.target.value)}
            spellCheck={false}
          />
        </label>
        <ModeField value={form.mode ?? 'fill'} onChange={(mode) => set('mode', mode)} />

        <div className="attr-editor">
          <span className="attr-editor-label">
            {t('envUrls.declared.form.attributes')}{' '}
            <span className="hint">{t('envUrls.declared.form.attributesHint')}</span>
          </span>
          {attributes.map((row, i) => (
            <div key={i} className="attr-row">
              <input
                className="mono-input"
                value={row.key}
                onChange={(e) => setRow(i, { key: e.target.value })}
                placeholder={t('envUrls.declared.form.attrKey')}
                spellCheck={false}
              />
              <input
                className="mono-input"
                value={row.value}
                onChange={(e) => setRow(i, { value: e.target.value })}
                placeholder={t('envUrls.declared.form.attrValue')}
                spellCheck={false}
              />
              <IconButton
                label={t('common.delete')}
                tone="danger"
                onClick={() => setAttributes((rows) => rows.filter((_, index) => index !== i))}
              >
                <DeleteIcon />
              </IconButton>
            </div>
          ))}
          <button
            className="btn with-icon"
            type="button"
            onClick={() => setAttributes((rows) => [...rows, { key: '', value: '' }])}
          >
            <PlusIcon /> {t('envUrls.declared.form.addAttribute')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
