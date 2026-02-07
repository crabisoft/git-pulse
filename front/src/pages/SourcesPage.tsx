import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  INCIDENT_TRACKER_KINDS,
  PAGE_LIMIT_MAX,
  QUOTA_LIMIT_MIN,
  SOURCE_HISTORY_PRESETS,
  isJobSettled,
  scopeFromSelection,
  scopeTracks,
  type ApiBudgetPublic,
  type ApiQuotaPublic,
  type EnvRulePublic,
  type JobHandle,
  type JobStatus,
  type RepoVisibility,
  type RepositoryRef,
  type RuleTarget,
  type ScopeRules,
  type SourceKind,
  type SourceMode,
  type SourcePublic,
  type ConnectionTestResult,
  type WebhookSetup,
  type PageInfo,
  type TrackerPublic,
} from '@repo/shared';
import {
  api,
  apiErrorInfo,
  type CreateSourceInput,
  type PageQuery,
  type UpdateSourceInput,
} from '../api';
import {
  DeepSyncIcon,
  DeleteIcon,
  EditIcon,
  PlusIcon,
  StarIcon,
  SyncIcon,
  TestIcon,
} from '../icons';
import { IconButton } from '../IconButton';
import { ConfirmDialog, Modal } from '../Modal';
import { MultiSelect } from '../MultiSelect';
import { Pagination } from '../Pagination';
import { QuotaGauge } from '../QuotaGauge';

interface FormState {
  name: string;
  kind: 'github' | 'gitlab';
  baseUrl: string;
  authKind: 'token' | 'app';
  /** Where the dashboard reads this source from. */
  mode: SourceMode;
  /** Accepts provider events. Only offered in `stored` mode. */
  webhooksEnabled: boolean;
  /**
   * How far back the ingestion reads, in days, as the select holds it. Empty
   * means "follow the reporting window", which is what the API stores as null.
   */
  historyDays: string;
  owner: string;
  /** Repos the scope names, either side of the rule below. */
  include: string[];
  exclude: string[];
  /** Whether a repo the owner gains later is tracked without being picked. */
  trackNewRepos: boolean;
  secret: string;
  appId: string;
  privateKey: string;
  installationId: string;
  /** Classification rules applied here, from the global catalogue. */
  envRuleIds: string[];
  /** Trackers this source's pull requests may reference. */
  trackerIds: string[];
  /** One of `trackerIds`, or empty for "collect no incident". */
  incidentTrackerId: string;
}

const EMPTY: FormState = {
  name: '',
  kind: 'github',
  baseUrl: 'https://github.com',
  authKind: 'token',
  mode: 'live',
  webhooksEnabled: false,
  historyDays: '',
  owner: '',
  // A new source tracks the whole owner: nothing to pick from before it exists,
  // and everything selected is what "I have just declared this org" means.
  include: [],
  exclude: [],
  trackNewRepos: true,
  secret: '',
  appId: '',
  privateKey: '',
  installationId: '',
  envRuleIds: [],
  trackerIds: [],
  incidentTrackerId: '',
};

function toInput(form: FormState): CreateSourceInput {
  const base = {
    name: form.name,
    kind: form.kind,
    baseUrl: form.baseUrl,
    authKind: form.authKind,
    mode: form.mode,
    // Refused by the API in `live` mode, and meaningless there anyway.
    webhooksEnabled: form.mode === 'stored' && form.webhooksEnabled,
    // Read by nothing in `live` mode either. Null is "follow the window".
    historyDays: form.mode === 'stored' && form.historyDays ? Number(form.historyDays) : null,
    scope: {
      owner: form.owner,
      include: form.include,
      exclude: form.exclude,
      trackNewRepos: form.trackNewRepos,
    },
    envRuleIds: form.envRuleIds,
    trackerIds: form.trackerIds,
    // Empty means none; the API spells that null.
    incidentTrackerId: form.incidentTrackerId || null,
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
    mode: source.mode,
    webhooksEnabled: source.webhooksEnabled,
    historyDays: source.historyDays === null ? '' : String(source.historyDays),
    owner: source.scope.owner,
    include: source.scope.include ?? [],
    exclude: source.scope.exclude ?? [],
    // Same fallback as the backend's: a scope written before the option existed
    // covered everything unless it named inclusions.
    trackNewRepos: source.scope.trackNewRepos ?? (source.scope.include ?? []).length === 0,
    envRuleIds: source.envRuleIds,
    trackerIds: source.trackerIds,
    incidentTrackerId: source.incidentTrackerId ?? '',
  };
}

/**
 * How often a queued re-read is asked where it got to.
 *
 * Slower than it could be on purpose: a deep re-read takes minutes, and the
 * only thing a tighter loop would buy is a spinner that stops a few seconds
 * earlier — paid for with a request per source per interval.
 */
const JOB_POLL_MS = 5_000;

/** How a settled job reads on the row that started it. */
function outcomeOf(status: JobStatus): ConnectionTestResult {
  if (status.state === 'failed') {
    return { ok: false, message: status.error ?? { code: 'errors.jobs.failed', params: {} } };
  }
  if (status.state === 'unknown') {
    return { ok: true, message: { code: 'sources.refresh.evicted', params: {} } };
  }
  // Completed, and possibly having given up on part of its work: the collector
  // catches its best-effort steps, so a green job is not a clean one.
  return status.warnings.length > 0
    ? { ok: false, message: status.warnings[0] }
    : { ok: true, message: { code: 'sources.refresh.done', params: {} } };
}

/**
 * The list holds its own window — the sources App keeps in memory feed the
 * source picker, which needs them all and must not follow the page size.
 */
export function SourcesPage({ onChange }: { onChange: () => Promise<void> }) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<SourcePublic[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [page, setPage] = useState<PageQuery>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [tested, setTested] = useState<Record<string, ConnectionTestResult | 'pending'>>({});
  /** Outcome of a collection asked for by hand, per source. */
  const [collected, setCollected] = useState<Record<string, ConnectionTestResult | 'pending'>>({});
  const [quotas, setQuotas] = useState<ApiQuotaPublic[]>([]);
  const [budgets, setBudgets] = useState<ApiBudgetPublic[]>([]);
  const [budgeting, setBudgeting] = useState<SourcePublic | null>(null);
  /** Open editor: `null` source means creation. */
  const [editing, setEditing] = useState<{ source: SourcePublic | null } | null>(null);
  const [deleting, setDeleting] = useState<SourcePublic | null>(null);
  /** A freshly issued webhook secret, shown once and never readable again. */
  const [webhookSetup, setWebhookSetup] = useState<IssuedWebhook | null>(null);
  /** Source whose deep re-read is being set up, before it is asked for. */
  const [refreshing, setRefreshing] = useState<SourcePublic | null>(null);
  /** Queued re-reads being followed, per source. Dropped once they settle. */
  const [jobs, setJobs] = useState<Record<string, JobHandle>>({});

  const load = useCallback(async () => {
    try {
      const result = await api.listSources(page);
      setSources(result.items);
      setPageInfo(result.page);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }, [page, t]);

  /**
   * Quotas are loaded on their own: they are metering, so a provider that sends
   * no rate-limit header — a self-hosted GitLab, typically — must cost the list
   * nothing more than an empty gauge.
   */
  const loadQuotas = useCallback(async () => {
    try {
      const [readings, declared] = await Promise.all([api.listQuotas(), api.listBudgets()]);
      setQuotas(readings);
      setBudgets(declared);
    } catch {
      setQuotas([]);
      setBudgets([]);
    }
  }, []);

  useEffect(() => {
    void loadQuotas();
  }, [loadQuotas]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Follows the queued re-reads until they settle.
   *
   * One timer for all of them rather than one each: a page with three sources
   * refreshing is still a page, and the states are read from the same tick.
   * A job the queue has evicted answers `unknown` — it ran, and nothing can say
   * how it went any more, which is reported as such rather than as a failure.
   */
  useEffect(() => {
    const handles = Object.entries(jobs);
    if (handles.length === 0) return;

    let live = true;
    const tick = async () => {
      const states = await Promise.all(
        handles.map(async ([sourceId, handle]) => {
          try {
            return [sourceId, await api.jobStatus(handle)] as const;
          } catch {
            // A reading that failed is not a run that failed: leave the row as
            // it is and try again on the next tick.
            return [sourceId, null] as const;
          }
        }),
      );
      if (!live) return;

      const settled = states.filter(([, s]) => s !== null && isJobSettled(s.state));
      if (settled.length === 0) return;

      setCollected((cur) => {
        const next = { ...cur };
        for (const [sourceId, status] of settled) next[sourceId] = outcomeOf(status!);
        return next;
      });
      setJobs((cur) => {
        const next = { ...cur };
        for (const [sourceId] of settled) delete next[sourceId];
        return next;
      });
      // A deep re-read is the heaviest thing this page starts, and the gauges
      // are the point of watching it from here.
      await loadQuotas();
    };

    const timer = setInterval(() => void tick(), JOB_POLL_MS);
    void tick();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [jobs, loadQuotas]);

  /** Quotas of a source, by bucket — a provider meters several of them. */
  const quotasBySource = useMemo(() => {
    const map = new Map<string, ApiQuotaPublic[]>();
    for (const quota of quotas) {
      if (quota.subjectKind !== 'source') continue;
      map.set(quota.subjectId, [...(map.get(quota.subjectId) ?? []), quota]);
    }
    return map;
  }, [quotas]);

  /** The ceiling declared for a source, if any — at most one per subject. */
  const budgetBySource = useMemo(() => {
    const map = new Map<string, ApiBudgetPublic>();
    for (const budget of budgets) {
      if (budget.subjectKind === 'source') map.set(budget.subjectId, budget);
    }
    return map;
  }, [budgets]);

  /** Refreshes both this list and the sources App holds (picker, badge). */
  async function refresh() {
    await Promise.all([load(), onChange()]);
  }

  async function test(id: string) {
    setTested((cur) => ({ ...cur, [id]: 'pending' }));
    try {
      const r = await api.testSource(id);
      setTested((cur) => ({ ...cur, [id]: r }));
    } catch (err) {
      setTested((cur) => ({ ...cur, [id]: { ok: false, message: apiErrorInfo(err) } }));
    }
    // The test spent a call: it is also the cheapest way to get a first reading
    // out of a source that has never been collected.
    await loadQuotas();
  }

  /**
   * Runs a collection now rather than waiting for the cron. On a stored source
   * this is also what fills the store: the ingestion is part of collecting it,
   * not a schedule of its own.
   *
   * The outcome is reported. The same call fires silently when a source is
   * first switched to `stored`, where a form closing is not the place for an
   * error — here it is, and swallowing it would leave an empty board with no
   * way to learn why.
   */
  async function collect(id: string) {
    setCollected((cur) => ({ ...cur, [id]: 'pending' }));
    try {
      const snapshots = await api.collectSource(id);
      setCollected((cur) => ({
        ...cur,
        [id]: { ok: true, message: { code: 'sources.collect.ok', params: { count: snapshots.length } } },
      }));
    } catch (err) {
      setCollected((cur) => ({ ...cur, [id]: { ok: false, message: apiErrorInfo(err) } }));
    }
    // A collection is the heaviest thing this page can start, and the gauges
    // are the point of watching it from here. The source itself did not change,
    // so nothing else needs reloading.
    await loadQuotas();
  }

  /**
   * Asks for a deep re-read and starts following it.
   *
   * Nothing is awaited here beyond the enqueueing: the run outlives the request
   * that asked for it, which is the whole reason it is queued. What comes back
   * is a handle, and the effect below is what turns it into a state on the row.
   *
   * The depth, when given, becomes the source's — so the list is reloaded, and
   * the purge will sweep at the new depth rather than the old one.
   */
  async function startRefresh(source: SourcePublic, historyDays?: number) {
    setRefreshing(null);
    setCollected((cur) => ({ ...cur, [source.id]: 'pending' }));
    try {
      const handle = await api.refreshSource(source.id, historyDays);
      setJobs((cur) => ({ ...cur, [source.id]: handle }));
      if (historyDays !== undefined) await refresh();
    } catch (err) {
      setCollected((cur) => ({ ...cur, [source.id]: { ok: false, message: apiErrorInfo(err) } }));
    }
  }

  /**
   * Makes a source the one the application opens on. At most one holds it, so
   * the whole list is reloaded rather than the one row: taking it changes the
   * source that had it, and a list showing two stars is a list that lies.
   */
  async function makeDefault(source: SourcePublic) {
    try {
      await api.makeDefaultSource(source.id);
      await refresh();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  async function remove(source: SourcePublic) {
    setDeleting(null);
    try {
      await api.deleteSource(source.id);
      setMsg({ kind: 'ok', text: t('sources.deleted') });
      await refresh();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  async function saved(created: boolean, webhook: IssuedWebhook | null) {
    setEditing(null);
    setMsg({ kind: 'ok', text: created ? t('sources.added') : t('sources.updated') });
    await refresh();
    // Shown after the refresh so the dialog lands on an up-to-date list, and
    // last because it is the one thing on screen that cannot be brought back.
    if (webhook) setWebhookSetup(webhook);
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
            const cs = collected[s.id];
            return (
              <li key={s.id} className="source-row">
                <div>
                  <div className="source-name">
                    {s.name} <span className={`kind-badge ${s.kind}`}>{s.kind}</span>
                  </div>
                  <div className="source-meta">
                    {s.baseUrl} · {s.scope.owner} · {t('sources.auth')}: {s.authKind} ·{' '}
                    {/* Said on the row as well as on the star: the star is the
                        control, and a control is not where a reader looks to
                        learn what is already true. */}
                    {s.isDefault && (
                      <span className="mode-badge default">{t('sources.default.badge')}</span>
                    )}
                    <span className={`mode-badge ${s.mode}`}>{t(`sources.mode.${s.mode}`)}</span>
                    {s.webhooksEnabled && (
                      <>
                        {' '}
                        <span className="mode-badge stored">{t('sources.webhooksOn')}</span>
                      </>
                    )}
                  </div>
                  {(quotasBySource.get(s.id) ?? []).map((quota) => (
                    <QuotaGauge key={quota.bucket} quota={quota} />
                  ))}
                  {/* Offered where a gauge is missing, and kept wherever one was
                      declared: a source the provider meters needs no ceiling
                      typed by hand, and saying so under every gauge would be
                      noise on the sources that are fine. */}
                  {(budgetBySource.has(s.id) || (quotasBySource.get(s.id) ?? []).length === 0) && (
                    <BudgetLine
                      budget={budgetBySource.get(s.id) ?? null}
                      onEdit={() => setBudgeting(s)}
                    />
                  )}
                  {ts && (
                    <div className={`source-test ${ts === 'pending' ? '' : ts.ok ? 'ok' : 'err'}`}>
                      {ts === 'pending'
                        ? t('common.testing')
                        : `${ts.ok ? '✓' : '✗'} ${t(ts.message.code, ts.message.params)}`}
                    </div>
                  )}
                  {cs && (
                    <div className={`source-test ${cs === 'pending' ? '' : cs.ok ? 'ok' : 'err'}`}>
                      {cs === 'pending'
                        ? jobs[s.id]
                          ? t('sources.refresh.running')
                          : t('sources.collect.running')
                        : `${cs.ok ? '✓' : '✗'} ${t(cs.message.code, cs.message.params)}`}
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  <IconButton
                    label={
                      s.isDefault ? t('sources.default.is') : t('sources.default.make')
                    }
                    // Nothing to press on the one that already holds it: the
                    // star is then a statement, not an offer.
                    disabled={s.isDefault}
                    onClick={() => void makeDefault(s)}
                  >
                    <StarIcon filled={s.isDefault} />
                  </IconButton>
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
                  <IconButton
                    label={t('sources.collect.action')}
                    disabled={cs === 'pending'}
                    onClick={() => void collect(s.id)}
                  >
                    <SyncIcon />
                  </IconButton>
                  {/* Only where there is a store to refill: a live source is
                      read from its provider at every request, so re-reading a
                      depth it does not keep would buy nothing. */}
                  {s.mode === 'stored' && (
                    <IconButton
                      label={
                        s.historyDays
                          ? t('sources.refresh.actionDays', { days: s.historyDays })
                          : t('sources.refresh.action')
                      }
                      disabled={cs === 'pending'}
                      onClick={() => setRefreshing(s)}
                    >
                      <DeepSyncIcon />
                    </IconButton>
                  )}
                  <IconButton label={t('common.delete')} tone="danger" onClick={() => setDeleting(s)}>
                    <DeleteIcon />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>

        {pageInfo && <Pagination info={pageInfo} value={page} onChange={setPage} />}
      </section>

      {editing && (
        <SourceDialog
          source={editing.source}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}

      {budgeting && (
        <BudgetDialog
          source={budgeting}
          budget={budgetBySource.get(budgeting.id) ?? null}
          onClose={() => setBudgeting(null)}
          onSaved={async () => {
            setBudgeting(null);
            await loadQuotas();
          }}
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

      {refreshing && (
        <RefreshDialog
          source={refreshing}
          onConfirm={(days) => void startRefresh(refreshing, days)}
          onClose={() => setRefreshing(null)}
        />
      )}

      {webhookSetup && (
        <WebhookDialog issued={webhookSetup} onClose={() => setWebhookSetup(null)} />
      )}
    </>
  );
}

/**
 * Confirms a deep re-read, and is where its depth is chosen.
 *
 * A dialog rather than a button that just runs: this is the most expensive
 * thing the page can start, and the depth it is given does not apply to the run
 * alone — it becomes the source's, because the purge sweeps each source at the
 * depth the source states. Saying so before the click is the whole point of
 * stopping here.
 */
function RefreshDialog({
  source,
  onConfirm,
  onClose,
}: {
  source: SourcePublic;
  onConfirm: (historyDays?: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Empty means "leave the depth as it is", which is the common case: most
  // re-reads are asked for to fill a store, not to change what it holds.
  const [depth, setDepth] = useState('');
  const title = t('sources.refresh.title', { name: source.name });

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
          <button
            className="btn primary"
            type="button"
            onClick={() => onConfirm(depth ? Number(depth) : undefined)}
            autoFocus
          >
            {t('sources.refresh.confirm')}
          </button>
        </>
      }
    >
      <p>{t('sources.refresh.explain')}</p>
      <label>
        {t('sources.refresh.depth')}
        <select value={depth} onChange={(e) => setDepth(e.target.value)}>
          <option value="">
            {source.historyDays
              ? t('sources.refresh.keepDays', { days: source.historyDays })
              : t('sources.refresh.keepWindow')}
          </option>
          {SOURCE_HISTORY_PRESETS.map((days) => (
            <option key={days} value={days}>
              {t('sources.form.historyOption', { count: days })}
            </option>
          ))}
        </select>
        <span className="hint">
          {depth ? t('sources.refresh.depthPersists') : t('sources.refresh.depthUnchanged')}
        </span>
      </label>
    </Modal>
  );
}

/** A secret just issued, and the platform it has to be declared on. */
interface IssuedWebhook {
  setup: WebhookSetup;
  kind: SourceKind;
}

/**
 * The one moment a webhook secret is readable. Closing it loses the value for
 * good — issuing another is the only way back, which is also how a leak is
 * recovered from.
 */
function WebhookDialog({ issued, onClose }: { issued: IssuedWebhook; onClose: () => void }) {
  const { t } = useTranslation();
  const { setup, kind } = issued;
  return (
    <Modal
      title={t('sources.webhook.title')}
      label={t('sources.webhook.title')}
      subtitle={t('sources.webhook.subtitle')}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="form">
        <label>
          {t('sources.webhook.url')} <span className="hint">{t('sources.webhook.urlHint')}</span>
          <input readOnly value={setup.path} onFocus={(e) => e.currentTarget.select()} />
          {/* Spelled out in full: the path alone reads as complete, and a hook
              declared without the /api prefix answers 404 with nothing to say
              why — the provider only reports the status. */}
          <span className="hint">{t('sources.webhook.urlShape', { path: setup.path })}</span>
        </label>
        <label>
          {t('sources.webhook.secret')}{' '}
          <span className="hint">{t('sources.webhook.secretHint')}</span>
          <input readOnly value={setup.secret} onFocus={(e) => e.currentTarget.select()} />
        </label>
        {/* Which boxes to tick, named as the platform names them: the point of
            this dialog is to be read next to the provider's own form. */}
        <p className="field-note">{t(`sources.webhook.events.${kind}`)}</p>
        {kind === 'github' && <p className="field-note">{t('sources.webhook.contentType')}</p>}
        <p className="field-note">{t('sources.webhook.warning')}</p>
      </div>
    </Modal>
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
  onSaved: (created: boolean, webhook: IssuedWebhook | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(source ? toForm(source) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackers, setTrackers] = useState<TrackerPublic[]>([]);
  const [envRules, setEnvRules] = useState<EnvRulePublic[]>([]);
  /**
   * The repos to pick from, and the picking. Null until asked for: reading them
   * costs the source a provider call, and most edits here are about something
   * else entirely.
   */
  const [repos, setRepos] = useState<RepositoryRef[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reposBusy, setReposBusy] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  useEffect(() => {
    // Few by nature, and all of them are selectable here: ask for the cap.
    // Errors surface: a swallowed one leaves an empty checklist that reads as
    // "nothing declared yet" and sends you looking in the wrong place.
    Promise.all([
      api.listTrackers({ limit: PAGE_LIMIT_MAX }).then(({ items }) => items),
      // One request per target: the catalogue is listed one target at a time.
      ...(['environment', 'repository', 'incident'] as RuleTarget[]).map((target) =>
        api.listEnvRules(target, { limit: PAGE_LIMIT_MAX }).then(({ items }) => items),
      ),
    ]).then(
      ([loadedTrackers, ...perTarget]) => {
        setTrackers(loadedTrackers as TrackerPublic[]);
        setEnvRules((perTarget as EnvRulePublic[][]).flat());
      },
      (err) => {
        const { code, params } = apiErrorInfo(err);
        setError(t(code, params));
      },
    );
  }, [t]);

  /**
   * Reads the catalogue and ticks it against the scope in force. Called on
   * demand, so the one provider call it costs is one somebody asked for.
   */
  async function showRepos() {
    if (!source) return;
    setReposBusy(true);
    setReposError(null);
    try {
      const items = await api.sourceRepositories(source.id);
      const scope: ScopeRules = {
        owner: form.owner,
        include: form.include,
        exclude: form.exclude,
        trackNewRepos: form.trackNewRepos,
      };
      setRepos(items);
      setSelected(new Set(items.filter((r) => scopeTracks(scope, r.name)).map((r) => r.name)));
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setReposError(t(code, params));
    } finally {
      setReposBusy(false);
    }
  }

  /**
   * Rewrites the scope from the picking every time either side of it moves.
   * Held as a selection here and as rules in the form, because that is what the
   * two ends need — and the shared conversion is the only one that translates.
   */
  function changeSelection(next: Set<string>, trackNewRepos = form.trackNewRepos) {
    setSelected(next);
    setForm((f) => ({
      ...f,
      ...scopeFromSelection((repos ?? []).map((r) => r.name), next, trackNewRepos),
    }));
  }

  /**
   * The catalogue was read for the owner the source was saved with, so a typed
   * one invalidates it: keeping the boxes ticked would let a selection be made
   * against repositories this source is about to stop reading.
   */
  function changeOwner(owner: string) {
    setRepos(null);
    setForm((f) => ({ ...f, owner }));
  }

  /** Adds or removes every repo of one visibility at once. */
  function changeVisibility(visibility: RepoVisibility, tracked: boolean) {
    const next = new Set(selected);
    for (const repo of repos ?? []) {
      if (repo.visibility !== visibility) continue;
      if (tracked) next.add(repo.name);
      else next.delete(repo.name);
    }
    changeSelection(next);
  }

  /** Visibilities this owner actually exposes — the others have nothing to offer. */
  const visibilities = useMemo(() => {
    const counts = new Map<RepoVisibility, number>();
    for (const repo of repos ?? []) counts.set(repo.visibility, (counts.get(repo.visibility) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [repos]);

  const selectedEnvRules = useMemo(() => new Set(form.envRuleIds), [form.envRuleIds]);
  const selectedTrackers = useMemo(() => new Set(form.trackerIds), [form.trackerIds]);

  /** Detaching the tracker that supplied incidents clears the designation too. */
  const changeTrackers = (trackerIds: string[]) =>
    setForm((f) => ({
      ...f,
      trackerIds,
      incidentTrackerId: trackerIds.includes(f.incidentTrackerId) ? f.incidentTrackerId : '',
    }));

  const attached = trackers.filter((tracker) => form.trackerIds.includes(tracker.id));
  // Only a kind an incident provider exists for may be designated; the API
  // refuses the rest, and offering them would be a promise it does not keep.
  const incidentCandidates = attached.filter((tracker) =>
    INCIDENT_TRACKER_KINDS.includes(tracker.kind),
  );

  /**
   * Why the list above is empty, when it is. A disabled control with no reason
   * given reads as a bug — and three quite different situations lead here.
   */
  const noIncidentTrackerReason =
    incidentCandidates.length > 0
      ? null
      : trackers.length === 0
        ? 'noTrackerDeclared'
        : attached.length === 0
          ? 'noTrackerAttached'
          : 'noEligibleTracker';

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
      const saved = source
        ? await api.updateSource(source.id, toUpdateInput(form))
        : await api.createSource(toInput(form));
      // A source that has just started reading from the store has nothing in it
      // yet: waiting for the next scheduled run would show an empty board for
      // as long as the cron says. Best-effort — the schedule catches up anyway.
      if (saved.mode === 'stored' && source?.mode !== 'stored') {
        await api.collectSource(saved.id).catch(() => undefined);
      }
      // Issued here rather than on the server's own initiative: the value is
      // readable exactly once, so it has to be asked for by whoever will read it.
      const setup =
        saved.webhooksEnabled && !source?.webhooksEnabled
          ? await api.issueWebhookSecret(saved.id).catch(() => null)
          : null;
      const webhook = setup ? { setup, kind: saved.kind } : null;
      await onSaved(!source, webhook);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const scopeSummary = useMemo(
    () =>
      !form.trackNewRepos
        ? { code: 'sources.form.reposCount', params: { count: form.include.length } }
        : form.exclude.length === 0
          ? { code: 'sources.form.reposAll', params: undefined }
          : { code: 'sources.form.reposAllBut', params: { count: form.exclude.length } },
    [form.trackNewRepos, form.include, form.exclude],
  );

  const ownerChanged = source !== null && form.owner !== source.scope.owner;

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
          <input value={form.owner} onChange={(e) => changeOwner(e.target.value)} required />
        </label>

        {/* Nothing to list before the source exists — its credentials are still
            in this form. A fresh one therefore takes the whole owner, and the
            picking happens on the next visit here. */}
        {!source ? (
          <p className="hint">{t('sources.form.reposOnCreate')}</p>
        ) : repos === null ? (
          <div className="repo-scope">
            <span>{t(scopeSummary.code, scopeSummary.params)}</span>
            <button
              className="btn"
              type="button"
              onClick={() => void showRepos()}
              disabled={reposBusy || ownerChanged}
            >
              {reposBusy ? t('sources.form.reposLoading') : t('sources.form.reposShow')}
            </button>
            {/* Listing would answer for the owner still stored, which is not the
                one being typed. */}
            {ownerChanged && (
              <span className="field-note">{t('sources.form.reposOwnerChanged')}</span>
            )}
          </div>
        ) : (
          <div className="repo-scope-editor">
            <span className="repo-scope-label">
              {t('sources.form.repos')} <span className="hint">{t('sources.form.reposHint')}</span>
            </span>
            <MultiSelect
              block
              options={repos.map((repo) => ({
                value: repo.name,
                label: repo.name,
                hint: t(`sources.repoVisibility.${repo.visibility}`),
              }))}
              selected={selected}
              onChange={(next) => changeSelection(next)}
              emptyLabel={t('sources.form.reposNoneSelected')}
            />
            {/* One row per visibility the owner exposes: "everything private,
                nothing public" is a whole selection on its own, and picking it
                repo by repo on a large org is not one anybody makes. */}
            <div className="repo-scope-bulk">
              {visibilities.map(([visibility, count]) => (
                <span key={visibility} className="repo-scope-group">
                  <span className="muted">
                    {t(`sources.repoVisibility.${visibility}`)} ({count})
                  </span>
                  <button type="button" onClick={() => changeVisibility(visibility, true)}>
                    {t('sources.form.reposSelectAll')}
                  </button>
                  <button type="button" onClick={() => changeVisibility(visibility, false)}>
                    {t('sources.form.reposClear')}
                  </button>
                </span>
              ))}
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.trackNewRepos}
                onChange={(e) => changeSelection(selected, e.target.checked)}
              />
              <span>
                {t('sources.form.trackNewRepos')}{' '}
                <span className="hint">{t('sources.form.trackNewReposHint')}</span>
              </span>
            </label>
          </div>
        )}
        {reposError && <div className="banner error">{reposError}</div>}

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

        <label>
          {t('sources.form.mode')} <span className="hint">{t('sources.form.modeHint')}</span>
          <select
            value={form.mode}
            onChange={(e) => set('mode', e.target.value as FormState['mode'])}
          >
            <option value="live">{t('sources.mode.live')}</option>
            <option value="stored">{t('sources.mode.stored')}</option>
          </select>
          <span className="hint">{t(`sources.mode.hint.${form.mode}`)}</span>
        </label>

        {/* Both of these only exist for a store: a live source is read from its
            provider in the instant, with no history of its own to keep. */}
        {form.mode === 'stored' && (
          <label>
            {t('sources.form.historyDays')}{' '}
            <span className="hint">{t('sources.form.historyDaysHint')}</span>
            <select
              value={form.historyDays}
              onChange={(e) => set('historyDays', e.target.value)}
            >
              <option value="">{t('sources.form.historyFollowsWindow')}</option>
              {SOURCE_HISTORY_PRESETS.map((days) => (
                <option key={days} value={days}>
                  {t('sources.form.historyOption', { count: days })}
                </option>
              ))}
            </select>
            <span className="hint">{t('sources.form.historyCostHint')}</span>
          </label>
        )}

        {form.mode === 'stored' && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.webhooksEnabled}
              onChange={(e) => set('webhooksEnabled', e.target.checked)}
            />
            <span>
              {t('sources.form.webhooks')}{' '}
              <span className="hint">{t('sources.form.webhooksHint')}</span>
            </span>
          </label>
        )}

        <label>
          {t('sources.form.envRules')}{' '}
          <span className="hint">{t('sources.form.envRulesHint')}</span>
          <MultiSelect
            block
            options={envRules.map((rule) => ({
              value: rule.id,
              label: rule.name,
              // Plain text so the built-in search reaches it too.
              hint: `${t(`envRules.target.${rule.target}.tab`)} · ${rule.kind}`,
            }))}
            selected={selectedEnvRules}
            onChange={(next) => set('envRuleIds', [...next])}
            emptyLabel={
              envRules.length === 0 ? t('sources.form.noEnvRules') : t('sources.form.noneSelected')
            }
          />
        </label>

        <label>
          {t('sources.form.trackers')}{' '}
          <span className="hint">{t('sources.form.trackersHint')}</span>
          <MultiSelect
            block
            options={trackers.map((tracker) => ({
              value: tracker.id,
              label: tracker.name,
              hint: tracker.kind,
            }))}
            selected={selectedTrackers}
            onChange={(next) => changeTrackers([...next])}
            emptyLabel={
              trackers.length === 0 ? t('sources.form.noTrackers') : t('sources.form.noneSelected')
            }
          />
        </label>

        <label>
          {t('sources.form.incidentTracker')}{' '}
          <span className="hint">{t('sources.form.incidentTrackerHint')}</span>
          <select
            value={form.incidentTrackerId}
            onChange={(e) => set('incidentTrackerId', e.target.value)}
            disabled={incidentCandidates.length === 0}
          >
            <option value="">{t('sources.form.noIncidentTracker')}</option>
            {incidentCandidates.map((tracker) => (
              <option key={tracker.id} value={tracker.id}>
                {tracker.name} ({tracker.kind})
              </option>
            ))}
          </select>
          {noIncidentTrackerReason && (
            <span className="field-note">
              {t(`sources.form.${noIncidentTrackerReason}`)}
            </span>
          )}
        </label>

        {error && <div className="banner error">{error}</div>}
      </form>
    </Modal>
  );
}

/**
 * The ceiling declared for a source, or the offer to declare one.
 *
 * Sits where the gauges are because it answers what their absence asks: an
 * instance that meters nothing draws none, and nothing else on the page would
 * say why, nor what can be done about it.
 */
function BudgetLine({ budget, onEdit }: { budget: ApiBudgetPublic | null; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="quota-budget">
      <span>
        {budget
          ? t('sources.budget.stated', {
              limit: budget.limit.toLocaleString(),
              window: t(`sources.budget.window.${budget.windowSec}`, {
                defaultValue: `${budget.windowSec}s`,
              }),
            })
          : t('sources.budget.none')}
      </span>
      <button type="button" onClick={onEdit}>
        {budget ? t('common.edit') : t('sources.budget.declare')}
      </button>
    </div>
  );
}

/** Declares, changes or withdraws what a source's instance allows. */
function BudgetDialog({
  source,
  budget,
  onClose,
  onSaved,
}: {
  source: SourcePublic;
  budget: ApiBudgetPublic | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(String(budget?.limit ?? 600));
  const [windowSec, setWindowSec] = useState(String(budget?.windowSec ?? 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onSaved();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() =>
      api.declareBudget(source.id, { limit: Number(limit), windowSec: Number(windowSec) }),
    );
  };

  const title = t('sources.budget.title', { name: source.name });

  return (
    <Modal
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <>
          {budget && (
            <button
              className="btn danger"
              type="button"
              disabled={busy}
              onClick={() => void run(() => api.withdrawBudget(source.id))}
            >
              {t('sources.budget.withdraw')}
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" type="submit" form="budget-form" disabled={busy}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="budget-form" onSubmit={submit} className="form">
        <p className="hint">{t('sources.budget.hint')}</p>
        <label>
          {t('sources.budget.limit')}
          <input
            type="number"
            min={QUOTA_LIMIT_MIN}
            step={1}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          {t('sources.budget.windowLabel')}
          <select value={windowSec} onChange={(e) => setWindowSec(e.target.value)}>
            {['60', '3600', '86400'].map((sec) => (
              <option key={sec} value={sec}>
                {t(`sources.budget.window.${sec}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="field-note">{t('sources.budget.observedNote')}</p>
        {error && <div className="banner error">{error}</div>}
      </form>
    </Modal>
  );
}
