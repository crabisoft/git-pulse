import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  PageInfo,
  VersionAuthKind,
  VersionFormat,
  VersionPreview,
  VersionRulePublic,
} from '@repo/shared';
import { api, apiErrorInfo, type CreateVersionRuleInput, type PageQuery } from '../api';
import { useDebounced } from '../hooks';
import { DeleteIcon, EditIcon, PlusIcon } from '../icons';
import { IconButton } from '../IconButton';
import { DataList } from '../DataList';
import { ConfirmDialog, Modal } from '../Modal';
import { Pagination } from '../Pagination';
import { ResponseTree } from '../ResponseTree';

const FORMATS: VersionFormat[] = ['json', 'xml', 'text'];
const AUTH_KINDS: VersionAuthKind[] = ['none', 'bearer', 'basic', 'header'];

const EMPTY: CreateVersionRuleInput = {
  name: '',
  environment: '',
  repo: '',
  urlTemplate: '{environmentUrl}/actuator/info',
  format: 'json',
  template: '',
  pattern: '',
  authKind: 'none',
  authHeader: '',
  priority: 100,
};

/** Module constant so a re-render never re-triggers the fetch. */
const FIRST_PAGE: PageQuery = {};

/** Long enough that a typed template is not previewed letter by letter. */
const PREVIEW_DEBOUNCE_MS = 400;

export function VersionRulesPage() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<VersionRulePublic[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [page, setPage] = useState<PageQuery>(FIRST_PAGE);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** Open editor: a null rule means creation. */
  const [editing, setEditing] = useState<{ rule: VersionRulePublic | null } | null>(null);
  const [deleting, setDeleting] = useState<VersionRulePublic | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.listVersionRules(page);
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

  async function remove(rule: VersionRulePublic) {
    setDeleting(null);
    try {
      await api.deleteVersionRule(rule.id);
      setMsg({ kind: 'ok', text: t('versionRules.deleted') });
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  async function saved(created: boolean) {
    setEditing(null);
    setMsg({ kind: 'ok', text: t(created ? 'versionRules.added' : 'versionRules.updated') });
    await load();
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('versionRules.listTitle')}</h2>
          <div className="panel-head-actions">
            <button className="btn primary with-icon" onClick={() => setEditing({ rule: null })}>
              <PlusIcon /> {t('versionRules.addTitle')}
            </button>
          </div>
        </div>
        <p className="muted subtabs-hint">{t('versionRules.hint')}</p>

        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
        {rules.length === 0 && <p className="muted">{t('versionRules.listEmpty')}</p>}

        {rules.length > 0 && (
          <DataList
            rows={rules}
            rowKey={(rule) => rule.id}
            columns={[
              {
                key: 'name',
                header: t('versionRules.form.name'),
                role: 'lead',
                cell: (rule) => rule.name,
              },
              {
                key: 'scope',
                header: t('versionRules.form.environment'),
                className: 'mono',
                // A rule bound to nothing applies everywhere, which is a fact
                // about it worth stating rather than an empty cell.
                cell: (rule) => (
                  <>
                    <div>{rule.environment ?? t('versionRules.everyEnvironment')}</div>
                    {rule.repo && <div className="muted">{rule.repo}</div>}
                  </>
                ),
              },
              {
                key: 'url',
                header: t('versionRules.form.urlTemplate'),
                className: 'mono',
                cell: (rule) => rule.urlTemplate,
              },
              {
                key: 'template',
                header: t('versionRules.form.template'),
                className: 'mono',
                cell: (rule) => (
                  <>
                    {rule.template}{' '}
                    <span className="pill attr">{t(`versionRules.format.${rule.format}`)}</span>
                    {rule.hasSecret && <span className="pill attr">{t('versionRules.hasSecret')}</span>}
                  </>
                ),
              },
              {
                key: 'priority',
                header: t('versionRules.form.priority'),
                className: 'num',
                cell: (rule) => rule.priority,
              },
              {
                key: 'actions',
                role: 'full',
                className: 'row-actions',
                cell: (rule) => (
                  <>
                    <IconButton label={t('common.edit')} onClick={() => setEditing({ rule })}>
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      label={t('common.delete')}
                      tone="danger"
                      onClick={() => setDeleting(rule)}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </>
                ),
              },
            ]}
          />
        )}

        {pageInfo && <Pagination info={pageInfo} value={page} onChange={setPage} />}
      </section>

      {editing && (
        <VersionRuleDialog
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('versionRules.deleteTitle')}
          message={t('versionRules.confirmDelete', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** A request header being edited: a list, so a half-typed name keeps its row. */
type HeaderRow = { name: string; value: string };

/**
 * Writing a rule, with the response beside it.
 *
 * The two halves are one screen on purpose. A template is not written, it is
 * tried: paste what the endpoint answers, click the value, read what came out.
 * Splitting the editor from the tester — the shape the classification rules
 * have — would be right for a regex somebody can read at a glance, and wrong
 * here, where the author is looking for a field in a document they did not
 * write.
 */
function VersionRuleDialog({
  rule,
  onClose,
  onSaved,
}: {
  rule: VersionRulePublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateVersionRuleInput>(
    rule
      ? {
          name: rule.name,
          environment: rule.environment ?? '',
          repo: rule.repo ?? '',
          urlTemplate: rule.urlTemplate,
          format: rule.format,
          template: rule.template,
          pattern: rule.pattern ?? '',
          authKind: rule.authKind,
          authHeader: rule.authHeader ?? '',
          priority: rule.priority,
        }
      : EMPTY,
  );
  const [headers, setHeaders] = useState<HeaderRow[]>(
    Object.entries(rule?.headers ?? {}).map(([name, value]) => ({ name, value })),
  );
  /** Never prefilled: the API does not hand a stored secret back. */
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateVersionRuleInput>(k: K, v: CreateVersionRuleInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const setHeaderRow = (index: number, patch: Partial<HeaderRow>) =>
    setHeaders((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const templateRef = useRef<HTMLInputElement>(null);
  /** Where the caret goes once the inserted placeholder is on screen. */
  const [caret, setCaret] = useState<number | null>(null);

  /**
   * Puts a picked path where the caret is, rather than at the end: a template
   * is `{a}-{b}`, and building one by clicking would otherwise mean going back
   * for the separator every time.
   */
  function insertPath(path: string) {
    const input = templateRef.current;
    const placeholder = `{${path}}`;
    const current = form.template;
    const at = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? at;
    set('template', current.slice(0, at) + placeholder + current.slice(end));
    setCaret(at + placeholder.length);
  }

  // After the field holds the new value, not before: a caret set on the old one
  // is moved to the end by the browser's own restoration when React writes it.
  useEffect(() => {
    if (caret === null) return;
    templateRef.current?.focus();
    templateRef.current?.setSelectionRange(caret, caret);
    setCaret(null);
  }, [caret]);

  function payload(): CreateVersionRuleInput {
    return {
      ...form,
      // Sent in full, so clearing a row clears the stored header.
      headers: Object.fromEntries(
        headers
          .map(({ name, value }) => [name.trim(), value.trim()] as const)
          .filter(([name]) => name !== ''),
      ),
      // Only the parsed formats read a path; a pattern left over from `text`
      // would otherwise be stored against a rule that ignores it.
      pattern: form.format === 'text' ? form.pattern : '',
      authHeader: form.authKind === 'header' ? form.authHeader : '',
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = payload();
      // An untouched field means "keep the stored secret", which only an
      // omission says — an empty string is how the API is told to forget one.
      if (rule) await api.updateVersionRule(rule.id, secret ? { ...body, secret } : body);
      else await api.createVersionRule(secret ? { ...body, secret } : body);
      await onSaved(!rule);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const title = rule ? t('versionRules.editTitle', { name: rule.name }) : t('versionRules.addTitle');

  return (
    <Modal
      title={title}
      label={title}
      onClose={onClose}
      // The response sits beside the template rather than under it: the whole
      // loop is click a value, read what came out, and a scroll between the two
      // would break it.
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={busy} type="submit" form="version-rule-form">
            {busy ? t('common.saving') : rule ? t('common.save') : t('versionRules.form.submit')}
          </button>
        </>
      }
    >
      <div className="version-editor">
        <form id="version-rule-form" onSubmit={submit} className="form">
          <label>
            {t('versionRules.form.name')}
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
              autoFocus
            />
          </label>

          <label>
            {t('versionRules.form.environment')}{' '}
            <span className="hint">{t('versionRules.form.environmentHint')}</span>
            <input
              className="mono-input"
              value={form.environment ?? ''}
              onChange={(e) => set('environment', e.target.value)}
              placeholder={t('versionRules.form.environmentPlaceholder')}
              spellCheck={false}
            />
          </label>

          <label>
            {t('versionRules.form.repo')} <span className="hint">{t('versionRules.form.repoHint')}</span>
            <input
              className="mono-input"
              value={form.repo ?? ''}
              onChange={(e) => set('repo', e.target.value)}
              spellCheck={false}
            />
          </label>

          <label>
            {t('versionRules.form.urlTemplate')}{' '}
            <span className="hint">{t('versionRules.form.urlTemplateHint')}</span>
            <input
              className="mono-input"
              value={form.urlTemplate}
              onChange={(e) => set('urlTemplate', e.target.value)}
              required
              spellCheck={false}
            />
          </label>

          <label>
            {t('versionRules.form.format')}
            <select
              value={form.format ?? 'json'}
              onChange={(e) => set('format', e.target.value as VersionFormat)}
            >
              {FORMATS.map((format) => (
                <option key={format} value={format}>
                  {t(`versionRules.format.${format}`)}
                </option>
              ))}
            </select>
          </label>

          {/* Only `text` reads groups out of a regex; the parsed formats read
              paths, and a pattern field there would be a question about nothing. */}
          {form.format === 'text' && (
            <label>
              {t('versionRules.form.pattern')}{' '}
              <span className="hint">{t('versionRules.form.patternHint')}</span>
              <input
                className="mono-input"
                value={form.pattern ?? ''}
                onChange={(e) => set('pattern', e.target.value)}
                required
                spellCheck={false}
              />
            </label>
          )}

          <label>
            {t('versionRules.form.template')}{' '}
            <span className="hint">{t('versionRules.form.templateHint')}</span>
            <input
              ref={templateRef}
              className="mono-input"
              value={form.template}
              onChange={(e) => set('template', e.target.value)}
              placeholder={t('versionRules.form.templatePlaceholder')}
              required
              spellCheck={false}
            />
          </label>

          <label>
            {t('versionRules.form.authKind')}
            <select
              value={form.authKind ?? 'none'}
              onChange={(e) => set('authKind', e.target.value as VersionAuthKind)}
            >
              {AUTH_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`versionRules.auth.${kind}`)}
                </option>
              ))}
            </select>
          </label>

          {form.authKind === 'header' && (
            <label>
              {t('versionRules.form.authHeader')}
              <input
                className="mono-input"
                value={form.authHeader ?? ''}
                onChange={(e) => set('authHeader', e.target.value)}
                placeholder="X-Api-Key"
                required
                spellCheck={false}
              />
            </label>
          )}

          {form.authKind !== 'none' && (
            <label>
              {t('versionRules.form.secret')}{' '}
              <span className="hint">
                {rule?.hasSecret ? t('versionRules.form.secretKept') : t('versionRules.form.secretHint')}
              </span>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="new-password"
              />
            </label>
          )}

          <div className="attr-editor">
            <span className="attr-editor-label">
              {t('versionRules.form.headers')}{' '}
              <span className="hint">{t('versionRules.form.headersHint')}</span>
            </span>
            {headers.map((row, i) => (
              <div className="attr-row" key={i}>
                <input
                  className="mono-input"
                  value={row.name}
                  placeholder={t('versionRules.form.headerName')}
                  onChange={(e) => setHeaderRow(i, { name: e.target.value })}
                  aria-label={t('versionRules.form.headerName')}
                  spellCheck={false}
                />
                <input
                  className="mono-input"
                  value={row.value}
                  placeholder={t('versionRules.form.headerValue')}
                  onChange={(e) => setHeaderRow(i, { value: e.target.value })}
                  aria-label={t('versionRules.form.headerValue')}
                  spellCheck={false}
                />
                <IconButton
                  label={t('common.delete')}
                  tone="danger"
                  onClick={() => setHeaders((rows) => rows.filter((_, at) => at !== i))}
                >
                  <DeleteIcon />
                </IconButton>
              </div>
            ))}
            <button
              type="button"
              className="btn with-icon"
              onClick={() => setHeaders((rows) => [...rows, { name: '', value: '' }])}
            >
              <PlusIcon /> {t('versionRules.form.addHeader')}
            </button>
          </div>

          <label>
            {t('versionRules.form.priority')}{' '}
            <span className="hint">{t('versionRules.form.priorityHint')}</span>
            <input
              type="number"
              min={0}
              value={form.priority ?? 100}
              onChange={(e) => set('priority', Number(e.target.value))}
            />
          </label>

          {error && <div className="banner error">{error}</div>}
        </form>

        <VersionTryPanel rule={rule} form={form} headers={headers} secret={secret} onPick={insertPath} />
      </div>
    </Modal>
  );
}

/**
 * The other half of the editor: one response, the tree it parses into, and what
 * the template makes of it.
 *
 * Pasting is the default and reaches no network — the address a rule is written
 * against is often one the browser can open and this backend cannot, and asking
 * a hosted install to read an address on a tenant's behalf is a capability, not
 * a convenience. Reading the URL is there for the case the paste cannot serve,
 * and it goes through the same refusals the scheduled probe does.
 */
function VersionTryPanel({
  rule,
  form,
  headers,
  secret,
  onPick,
}: {
  rule: VersionRulePublic | null;
  form: CreateVersionRuleInput;
  headers: HeaderRow[];
  secret: string;
  onPick: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [url, setUrl] = useState(() => (form.urlTemplate.includes('{') ? '' : form.urlTemplate));
  const [preview, setPreview] = useState<VersionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  // Debounced, and on the pasted body alone: every keystroke of a template
  // would otherwise be a request, and the answer to the one before it is
  // already stale by the time it lands.
  const debouncedTemplate = useDebounced(form.template, PREVIEW_DEBOUNCE_MS);
  const debouncedPattern = useDebounced(form.pattern ?? '', PREVIEW_DEBOUNCE_MS);

  const headerMap = Object.fromEntries(
    headers.map(({ name, value }) => [name.trim(), value.trim()]).filter(([name]) => name !== ''),
  );

  useEffect(() => {
    if (!body.trim() || !debouncedTemplate) return setPreview(null);
    let live = true;
    void api
      .previewVersionRule({
        body,
        format: form.format,
        template: debouncedTemplate,
        pattern: form.format === 'text' ? debouncedPattern : undefined,
      })
      .then(
        (result) => live && (setPreview(result), setError(null)),
        (err) => {
          if (!live) return;
          const { code, params } = apiErrorInfo(err);
          setError(t(code, params));
        },
      );
    return () => {
      live = false;
    };
  }, [body, debouncedTemplate, debouncedPattern, form.format, t]);

  /** Reads the address, and keeps the body so the tree survives the request. */
  async function read() {
    setReading(true);
    setError(null);
    try {
      const result = await api.previewVersionRule({
        url,
        format: form.format,
        // A rule being written has no template yet — the tree is what the read
        // was for. The API needs one, so it gets one that reads nothing, and
        // the result it produces is not shown.
        template: form.template || '{}',
        pattern: form.format === 'text' ? form.pattern : undefined,
        headers: headerMap,
        authKind: form.authKind,
        authHeader: form.authHeader,
        secret: secret || undefined,
        // Lets a saved rule be re-tried without its secret making the round
        // trip to the browser and back.
        ruleId: secret ? undefined : rule?.id,
      });
      setPreview(result);
      setBody(result.body);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="version-try">
      <h4>{t('versionRules.try.title')}</h4>
      <p className="muted">{t('versionRules.try.hint')}</p>

      <label>
        {t('versionRules.try.body')}
        <textarea
          className="mono-input"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('versionRules.try.bodyPlaceholder')}
          spellCheck={false}
        />
      </label>

      <div className="version-try-url">
        <input
          className="mono-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('versionRules.try.urlPlaceholder')}
          aria-label={t('versionRules.try.url')}
          spellCheck={false}
        />
        <button className="btn" type="button" onClick={() => void read()} disabled={!url || reading}>
          {reading ? t('versionRules.try.reading') : t('versionRules.try.read')}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {preview && (
        <>
          {form.template && (
          <div className={`version-result ${preview.version ? 'ok' : 'bad'}`}>
            <span className="cr-label">{t('versionRules.try.result')}</span>
            {preview.version ? (
              <strong className="mono">{preview.version}</strong>
            ) : (
              <span className="muted">
                {preview.reason ? t(preview.reason.code, preview.reason.params) : t('versionRules.try.nothing')}
              </span>
            )}
            {preview.httpStatus !== null && (
              <span className="pill attr">HTTP {preview.httpStatus}</span>
            )}
          </div>
          )}

          {preview.tree !== null ? (
            <ResponseTree value={preview.tree} onPick={onPick} />
          ) : (
            // `text` parses nothing by design, so there is no tree to click —
            // its template reads the pattern's named groups instead.
            <p className="muted">{t('versionRules.try.noTree')}</p>
          )}
        </>
      )}
    </div>
  );
}
