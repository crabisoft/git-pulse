import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  INCIDENT_TRACKER_KINDS,
  PAGE_LIMIT_MAX,
  type ApiQuotaPublic,
  type EnvRulePublic,
  type RuleTarget,
  type SourcePublic,
  type ConnectionTestResult,
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
import { DeleteIcon, EditIcon, PlusIcon, TestIcon } from '../icons';
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
  owner: string;
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
  owner: '',
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
    scope: { owner: form.owner },
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
    owner: source.scope.owner,
    envRuleIds: source.envRuleIds,
    trackerIds: source.trackerIds,
    incidentTrackerId: source.incidentTrackerId ?? '',
  };
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
  const [quotas, setQuotas] = useState<ApiQuotaPublic[]>([]);
  /** Open editor: `null` source means creation. */
  const [editing, setEditing] = useState<{ source: SourcePublic | null } | null>(null);
  const [deleting, setDeleting] = useState<SourcePublic | null>(null);

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
      setQuotas(await api.listQuotas());
    } catch {
      setQuotas([]);
    }
  }, []);

  useEffect(() => {
    void loadQuotas();
  }, [loadQuotas]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Quotas of a source, by bucket — a provider meters several of them. */
  const quotasBySource = useMemo(() => {
    const map = new Map<string, ApiQuotaPublic[]>();
    for (const quota of quotas) {
      if (quota.subjectKind !== 'source') continue;
      map.set(quota.subjectId, [...(map.get(quota.subjectId) ?? []), quota]);
    }
    return map;
  }, [quotas]);

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

  async function saved(created: boolean) {
    setEditing(null);
    setMsg({ kind: 'ok', text: created ? t('sources.added') : t('sources.updated') });
    await refresh();
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
            return (
              <li key={s.id} className="source-row">
                <div>
                  <div className="source-name">
                    {s.name} <span className={`kind-badge ${s.kind}`}>{s.kind}</span>
                  </div>
                  <div className="source-meta">
                    {s.baseUrl} · {s.scope.owner} · {t('sources.auth')}: {s.authKind}
                  </div>
                  {(quotasBySource.get(s.id) ?? []).map((quota) => (
                    <QuotaGauge key={quota.bucket} quota={quota} />
                  ))}
                  {ts && (
                    <div className={`source-test ${ts === 'pending' ? '' : ts.ok ? 'ok' : 'err'}`}>
                      {ts === 'pending'
                        ? t('common.testing')
                        : `${ts.ok ? '✓' : '✗'} ${t(ts.message.code, ts.message.params)}`}
                    </div>
                  )}
                </div>
                <div className="row-actions">
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

      {deleting && (
        <ConfirmDialog
          title={t('sources.deleteTitle')}
          message={t('sources.confirmDelete', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
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
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(source ? toForm(source) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackers, setTrackers] = useState<TrackerPublic[]>([]);
  const [envRules, setEnvRules] = useState<EnvRulePublic[]>([]);

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
      if (source) await api.updateSource(source.id, toUpdateInput(form));
      else await api.createSource(toInput(form));
      await onSaved(!source);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

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
          <input value={form.owner} onChange={(e) => set('owner', e.target.value)} required />
        </label>
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
