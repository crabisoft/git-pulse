import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PAGE_LIMIT_MAX,
  type PageInfo,
  type TicketRef,
  type TicketRulePublic,
  type TrackerPublic,
} from '@repo/shared';
import { api, apiErrorInfo, type CreateTicketRuleInput, type PageQuery } from '../api';
import { DeleteIcon, EditIcon, PlusIcon } from '../icons';
import { IconButton } from '../IconButton';
import { DataList } from '../DataList';
import { Modal, ConfirmDialog } from '../Modal';
import { Pagination } from '../Pagination';

const EMPTY: CreateTicketRuleInput = { trackerId: '', name: '', pattern: '', priority: 100 };

/** Module constant so resetting on source change never re-triggers a fetch. */
const FIRST_PAGE: PageQuery = {};

export function TicketRulesPage() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<TicketRulePublic[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [page, setPage] = useState<PageQuery>(FIRST_PAGE);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [editing, setEditing] = useState<{ rule: TicketRulePublic | null } | null>(null);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState<TicketRulePublic | null>(null);
  /** Only the trackers attached to this source may be pointed at. */
  const [trackers, setTrackers] = useState<TrackerPublic[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await api.listTicketRules(page);
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

  useEffect(() => {
    // Every declared tracker: a rule belongs to one, not to a source.
    api.listTrackers({ limit: PAGE_LIMIT_MAX }).then(
      ({ items }) => setTrackers(items),
      (err) => {
        const { code, params } = apiErrorInfo(err);
        setMsg({ kind: 'err', text: t(code, params) });
      },
    );
  }, [t]);


  async function remove(rule: TicketRulePublic) {
    setDeleting(null);
    try {
      await api.deleteTicketRule(rule.id);
      setMsg({ kind: 'ok', text: t('ticketRules.deleted') });
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  async function saved(created: boolean) {
    setEditing(null);
    setMsg({ kind: 'ok', text: t(created ? 'ticketRules.added' : 'ticketRules.updated') });
    await load();
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('ticketRules.listTitle')}</h2>
          <div className="panel-head-actions">
            <button className="btn" onClick={() => setTesting(true)} disabled={rules.length === 0}>
              {t('ticketRules.testAll')}
            </button>
            <button
              className="btn primary"
              onClick={() => setEditing({ rule: null })}
              disabled={trackers.length === 0}
            >
              <PlusIcon /> {t('ticketRules.addTitle')}
            </button>
          </div>
        </div>
        <p className="muted subtabs-hint">{t('ticketRules.hint')}</p>

        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
        {/* A rule points at a tracker, so there is nothing to create without one. */}
        {trackers.length === 0 && <p className="muted">{t('ticketRules.noTracker')}</p>}
        {trackers.length > 0 && rules.length === 0 && (
          <p className="muted">{t('ticketRules.listEmpty')}</p>
        )}

        {rules.length > 0 && (
          <DataList
            rows={rules}
            rowKey={(rule) => rule.id}
            columns={[
              {
                key: 'name',
                header: t('ticketRules.form.name'),
                role: 'lead',
                cell: (rule) => rule.name,
              },
              {
                key: 'pattern',
                header: t('ticketRules.form.pattern'),
                className: 'mono',
                cell: (rule) => rule.pattern,
              },
              {
                key: 'tracker',
                header: t('ticketRules.form.tracker'),
                cell: (rule) => (
                  <span className="pill attr">
                    {trackers.find((tr) => tr.id === rule.trackerId)?.name ?? rule.trackerId}
                  </span>
                ),
              },
              {
                key: 'priority',
                header: t('ticketRules.form.priority'),
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
                    <IconButton label={t('common.delete')} tone="danger" onClick={() => setDeleting(rule)}>
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
        <TicketRuleDialog
          trackers={trackers}
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}

      {testing && <TicketRuleTestDialog onClose={() => setTesting(false)} />}

      {deleting && (
        <ConfirmDialog
          title={t('ticketRules.deleteTitle')}
          message={t('ticketRules.confirmDelete', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** Create/edit form, in a modal. `rule` null means creation. */
function TicketRuleDialog({
  trackers,
  rule,
  onClose,
  onSaved,
}: {
  trackers: TrackerPublic[];
  rule: TicketRulePublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateTicketRuleInput>(
    rule
      ? {
          trackerId: rule.trackerId,
          name: rule.name,
          pattern: rule.pattern,
          priority: rule.priority,
        }
      : { ...EMPTY, trackerId: trackers[0]?.id ?? '' },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateTicketRuleInput>(k: K, v: CreateTicketRuleInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (rule) await api.updateTicketRule(rule.id, form);
      else await api.createTicketRule(form);
      await onSaved(!rule);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const title = rule ? t('ticketRules.editTitle', { name: rule.name }) : t('ticketRules.addTitle');

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
          <button className="btn primary" disabled={busy} type="submit" form="ticket-rule-form">
            {busy ? t('common.saving') : rule ? t('common.save') : t('ticketRules.form.submit')}
          </button>
        </>
      }
    >
      <form id="ticket-rule-form" onSubmit={submit} className="form">
        <label>
          {t('ticketRules.form.name')}
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        </label>
        <label>
          {t('ticketRules.form.pattern')}{' '}
          <span className="hint">{t('ticketRules.form.patternHint')}</span>
          <input
            className="mono-input"
            value={form.pattern}
            onChange={(e) => set('pattern', e.target.value)}
            required
            spellCheck={false}
          />
        </label>
        <label>
          {t('ticketRules.form.tracker')}{' '}
          <span className="hint">{t('ticketRules.form.trackerHint')}</span>
          <select
            value={form.trackerId}
            onChange={(e) => set('trackerId', e.target.value)}
            required
          >
            {trackers.map((tracker) => (
              <option key={tracker.id} value={tracker.id}>
                {tracker.name} ({tracker.kind})
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('ticketRules.form.priority')}{' '}
          <span className="hint">{t('ticketRules.form.priorityHint')}</span>
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
 * Runs the source's saved rules over a sample. The only practical way to catch
 * a pattern that matches too much — `[A-Z]{2,5}-\\d+` also eats `UTF-8` — and
 * the only place the built URL can be checked before it reaches a PR.
 */
function TicketRuleTestDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [branch, setBranch] = useState('');
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [result, setResult] = useState<TicketRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setResult(
        await api.previewTicketRules({
          branch,
          title,
          owner: owner || undefined,
          repo: repo || undefined,
        }),
      );
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
    }
  }

  const dialogTitle = t('ticketRules.preview.title');
  return (
    <Modal
      title={dialogTitle}
      label={dialogTitle}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button className="btn primary" type="submit" form="ticket-preview-form">
            {t('ticketRules.preview.run')}
          </button>
        </>
      }
    >
      <form id="ticket-preview-form" onSubmit={run} className="form">
        <p className="muted">{t('ticketRules.preview.hint')}</p>
        <label>
          {t('ticketRules.preview.branch')}
          <input
            className="mono-input"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="feature/OPS-123-fix-login"
            spellCheck={false}
            autoFocus
          />
        </label>
        <label>
          {t('ticketRules.preview.prTitle')}
          <input
            className="mono-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="OPS-123 Fix login"
            spellCheck={false}
          />
        </label>
        <label>
          {t('ticketRules.preview.owner')}{' '}
          <span className="hint">{t('ticketRules.preview.repoHint')}</span>
          <input
            className="mono-input"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="acme"
            spellCheck={false}
          />
        </label>
        <label>
          {t('ticketRules.preview.repo')}
          <input
            className="mono-input"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="extranet-api"
            spellCheck={false}
          />
        </label>
        {error && <div className="banner error">{error}</div>}
        {result && (
          <div>
            <h4>{t('ticketRules.preview.found')}</h4>
            {result.length === 0 ? (
              <p className="muted">{t('ticketRules.preview.none')}</p>
            ) : (
              <ul className="preview-refs">
                {result.map((ref) => (
                  <li key={`${ref.tracker.id}:${ref.key}`}>
                    <span className="pill attr">
                      <b>{ref.tracker.name}</b> {ref.key}
                    </span>
                    <span className="muted"> {t(`ticketRules.source.${ref.foundIn}`)}</span>
                    {/* The URL is the half a pattern test cannot validate. */}
                    {ref.url ? (
                      <a className="mono" href={ref.url} target="_blank" rel="noreferrer">
                        {ref.url}
                      </a>
                    ) : (
                      <span className="muted mono">{t('ticketRules.preview.noUrl')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
