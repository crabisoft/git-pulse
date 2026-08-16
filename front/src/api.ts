import type {
  ApiBudgetInput,
  ApiBudgetPublic,
  ApiQuotaPublic,
  AppSettings,
  AuthState,
  PasswordResetIssued,
  PasswordResetTarget,
  UserPublic,
  UserRole,
  SourceCoverage,
  SourceMode,
  SourcePublic,
  WebhookSetup,
  DashboardLive,
  DisplayMode,
  Incident,
  OverviewDirection,
  OverviewReport,
  ConnectionTestResult,
  CodedMessage,
  EnvRulePublic,
  EnvUrlMode,
  EnvUrlRulePublic,
  ManualEnvironmentPublic,
  ClassifiedEnvironment,
  Branch,
  ChangelogReport,
  DeploymentBase,
  DeploymentChangelog,
  DeploymentChanges,
  DeploymentReport,
  DoraMetric,
  DoraReport,
  DoraSample,
  JobFailure,
  JobRunning,
  JobHandle,
  JobStatus,
  JobWarning,
  JobsSnapshot,
  LlmKind,
  QueueName,
  PipelineStatus,
  LlmProviderPublic,
  ReleaseNotes,
  RepositoryRef,
  RewriteRequest,
  RewriteResult,
  Tag,
  MetricSeries,
  MetricSnapshotPublic,
  Page,
  RuleTarget,
  ScopeRules,
  TicketRef,
  TicketRulePublic,
  TicketSource,
  TrackerKind,
  TrackerPublic,
  EnvironmentVersion,
  VersionAuthKind,
  VersionFormat,
  VersionPreview,
  VersionHistory,
  VersionProbeOutcome,
  VersionRulePublic,
} from '@repo/shared';

// Relative by default (same-origin, via the Vite dev proxy / nginx). An absolute
// VITE_API_URL can override it when the API lives on another origin.
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api';

/** Error carrying an i18n code + params, thrown by the API client. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** Extracts a translatable message from any thrown value. */
export function apiErrorInfo(e: unknown): CodedMessage {
  if (e instanceof ApiError) return { code: e.code, params: e.params };
  return { code: 'errors.network', params: { error: e instanceof Error ? e.message : String(e) } };
}

/**
 * True when the caller cancelled the request rather than the request failing.
 * An abort is a decision, not an incident: it must never surface as an error.
 */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/**
 * Called whenever the API answers that the session no longer opens a route —
 * expired, signed out elsewhere, or a role that has just been taken away. The
 * auth provider registers itself here so a stale screen re-reads its state
 * instead of showing an error nobody can act on.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      // Sent along even cross-origin, which is what carries the session cookie
      // when VITE_API_URL points the frontend at another host.
      credentials: 'include',
      ...init,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError('errors.network', { error: e instanceof Error ? e.message : String(e) });
  }

  if (res.status === 401 || res.status === 403) onUnauthorized?.();

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { code?: string; params?: Record<string, string | number> }
      | null;
    if (body?.code) throw new ApiError(body.code, body.params);
    throw new ApiError('errors.http', { status: res.status, detail: res.statusText });
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

type QueryValue = string | number | string[] | undefined;

/** Builds a query string, dropping the params left undefined. */
function qs(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Page window accepted by every list route. `limit` may not exceed
 * PAGE_LIMIT_MAX; omitting it applies the configured page size
 * (`AppSettings.pageSize`).
 */
export interface PageQuery {
  limit?: number;
  offset?: number;
}

/** The live view bundles three lists, each windowed independently. */
export interface DashboardLiveQuery {
  /** Repo filter; omitted means every repo in the source scope. */
  repos?: string[];
  prs?: PageQuery;
  pipelines?: PageQuery;
  environments?: PageQuery;
}

/** Failed jobs of one queue, or of every queue when none is named. */
export interface FailedJobsQuery extends PageQuery {
  queue?: QueueName;
}

export interface MetricsQuery extends PageQuery {
  metric?: string;
  from?: string;
  to?: string;
}

/** Period, scope and slice of the DORA endpoint. Every field is optional. */
export interface DoraQuery extends PageQuery {
  /** Explicit bounds; `from` takes precedence over `windowDays`. */
  from?: string;
  to?: string;
  /** Rolling window in days; omitted means the one set in the settings. */
  windowDays?: number;
  /** Scopes the collection; empty means every repo in scope. */
  repos?: string[];
  /** Keeps only the results carrying every key/value pair. */
  dimensions?: Record<string, string>;
}

/**
 * The DORA query, plus what only a list narrows on. Extended rather than
 * restated: the two views must agree on what a period and a repo scope mean.
 */
export interface DeploymentsQuery extends DoraQuery {
  /** Environment names, matched exactly; empty means every one. */
  environments?: string[];
  statuses?: PipelineStatus[];
}

/**
 * The scope of an overview. The same period and dimensions as everywhere else,
 * plus the meta-environment — a name covering several patterns, which is not
 * an attribute and does not belong among them.
 *
 * No page window: the page groups and pivots what comes back.
 */
export interface OverviewQuery {
  from?: string;
  to?: string;
  windowDays?: number;
  repos?: string[];
  dimensions?: Record<string, string>;
  meta?: string;
}

/**
 * What narrows the changelog archive.
 *
 * No rolling window, unlike every other report: the archive exists to be read
 * months later, so no period at all means the whole history rather than the
 * configured one.
 */
export interface ChangelogsQuery extends PageQuery {
  repos?: string[];
  environments?: string[];
  /** Free text, matched against the rendered notes and the deployed ref. */
  search?: string;
  from?: string;
  to?: string;
}

export interface CreateSourceInput {
  name: string;
  kind: 'github' | 'gitlab';
  baseUrl: string;
  authKind: 'token' | 'app';
  secret?: string;
  app?: { appId: string; privateKey: string; installationId: string };
  scope: ScopeRules;
  /** Where the dashboard reads it from. Omitted means `live`. */
  mode?: SourceMode;
  /** Refused unless the mode is `stored`; turning it off drops the secret. */
  webhooksEnabled?: boolean;
  /** Classification rules that apply here — supplying it replaces the set. */
  envRuleIds?: string[];
  /** Address rules deriving where its environments answer — supplying it replaces the set. */
  envUrlRuleIds?: string[];
  /** Trackers this source's PRs may reference — supplying it replaces the set. */
  trackerIds?: string[];
  /** One of `trackerIds`, or null to collect no incident. */
  incidentTrackerId?: string | null;
}

/** Every field is optional; omitting the secret keeps the stored one. */
export type UpdateSourceInput = Partial<CreateSourceInput>;

export interface CreateEnvRuleInput {
  name: string;
  pattern: string;
  kind: 'simple' | 'meta';
  /** Omitted means `environment`. */
  target?: RuleTarget;
  priority?: number;
  /** Forced on a match, for what the name carries nothing to capture. */
  attributes?: Record<string, string>;
  /** Confines the rule to the repos this matches. Empty means all of them. */
  repo?: string;
}

/** Every field is optional; omitted ones keep their stored value. */
export type UpdateEnvRuleInput = Partial<CreateEnvRuleInput>;

export interface CreateEnvUrlRuleInput {
  name: string;
  /** Matched against the environment name; its named groups feed the template. */
  pattern: string;
  /** Confines the rule to the repos this matches. Empty means all of them. */
  repo?: string;
  urlTemplate: string;
  /** Omitted means `fill`: replacing a published address is the deliberate act. */
  mode?: EnvUrlMode;
  priority?: number;
}

export type UpdateEnvUrlRuleInput = Partial<CreateEnvUrlRuleInput>;

export interface CreateManualEnvironmentInput {
  environment: string;
  /** Omitted or empty: the environment belongs to no repo. */
  repo?: string;
  url?: string;
  attributes?: Record<string, string>;
  mode?: EnvUrlMode;
}

export type UpdateManualEnvironmentInput = Partial<CreateManualEnvironmentInput>;

/** What a candidate rule set would make of one environment, saving nothing. */
export interface EnvUrlPreviewInput {
  environment: string;
  repo?: string;
  ref?: string;
  /** What the platform would have published — `fill` stands down in its presence. */
  environmentUrl?: string;
  attributes?: Record<string, string>;
  rules: CreateEnvUrlRuleInput[];
}

export interface EnvUrlPreview {
  /** Where the rules say it answers — null when none of them can say. */
  url: string | null;
  published: string | null;
  /** The rule that answered, or that claimed the environment and could not. */
  rule: string | null;
  /** Whether a declaration by hand answered, which outranks every rule. */
  declared: boolean;
  /**
   * The placeholder that kept the rule silent, when one did. What tells a
   * template to fix from a pattern that never matched — the two produce the
   * same absent address and nothing else distinguishes them.
   */
  unresolved: string | null;
}

export interface CreateTicketRuleInput {
  trackerId: string;
  name: string;
  pattern: string;
  /** The texts the pattern is run over. Omitted keeps the server's default. */
  sources?: TicketSource[];
  priority?: number;
}

export type UpdateTicketRuleInput = Partial<CreateTicketRuleInput>;

export interface CreateVersionRuleInput {
  name: string;
  /** Confines the rule to the environments this matches. Empty means all. */
  environment?: string;
  /** Confines the rule to the repos this matches. Empty means all. */
  repo?: string;
  urlTemplate: string;
  /** Omitted means `json`. */
  format?: VersionFormat;
  template: string;
  /** Required by `text`, ignored by the parsed formats. */
  pattern?: string;
  headers?: Record<string, string>;
  authKind?: VersionAuthKind;
  authHeader?: string;
  /** Written once and never read back; the rule only reports `hasSecret`. */
  secret?: string;
  priority?: number;
}

/** Omitting the secret keeps the stored one; sending an empty string clears it. */
export type UpdateVersionRuleInput = Partial<CreateVersionRuleInput>;

/**
 * Trying a rule out. `body` is the default way in and touches no network — a
 * response pasted from wherever its author already had it open. `url` is read
 * only when no body was given.
 */
export interface VersionPreviewInput {
  body?: string;
  url?: string;
  format?: VersionFormat;
  template: string;
  pattern?: string;
  headers?: Record<string, string>;
  authKind?: VersionAuthKind;
  authHeader?: string;
  /** For a rule being written, which has no stored secret yet. */
  secret?: string;
  /** For a saved one, so its secret never travels to the browser and back. */
  ruleId?: string;
}

export interface CreateTrackerInput {
  name: string;
  kind: TrackerKind;
  baseUrl: string;
  /** Omitted or null falls back to the link shape derived from the kind. */
  urlTemplate?: string | null;
}

export type UpdateTrackerInput = Partial<CreateTrackerInput>;

/** Declaring a model provider. The key is written once and never read back. */
export interface CreateLlmProviderInput {
  name: string;
  kind: LlmKind;
  model: string;
  apiKey: string;
  /** Empty means the vendor's public endpoint; the API spells that null. */
  baseUrl?: string | null;
  isDefault?: boolean;
}

/** An omitted `apiKey` keeps the stored one — the form never held it. */
export type UpdateLlmProviderInput = Partial<CreateLlmProviderInput>;

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  /** Omitted means `user`. */
  role?: UserRole;
}

/** Every field is optional; omitting the password keeps the stored one. */
export type UpdateUserInput = Partial<CreateUserInput>;

export const api = {
  /** Session state in one call: who you are, and what this install is open to. */
  authState: () => request<AuthState>('/auth/me'),
  login: (email: string, password: string) =>
    request<AuthState>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  /**
   * What an account may change about itself. The role and the address are not
   * part of it — an admin hands those out.
   */
  updateMe: (input: {
    name?: string;
    password?: string;
    currentPassword?: string;
    /** Null hands the choice back to the installation default. */
    displayDirection?: OverviewDirection | null;
    displayMode?: DisplayMode | null;
  }) => request<AuthState>('/auth/me', { method: 'PATCH', body: JSON.stringify(input) }),
  /** First admin of a fresh install — refused once an account exists. */
  setupAdmin: (input: CreateUserInput) =>
    request<AuthState>('/auth/setup', { method: 'POST', body: JSON.stringify(input) }),

  listUsers: (page?: PageQuery) => request<Page<UserPublic>>(`/users${qs({ ...page })}`),
  createUser: (input: CreateUserInput) =>
    request<UserPublic>('/users', { method: 'POST', body: JSON.stringify(input) }),
  updateUser: (id: string, input: UpdateUserInput) =>
    request<UserPublic>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteUser: (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' }),
  /** Mints a one-shot link for an account. The token is readable only here. */
  issueResetLink: (id: string) =>
    request<PasswordResetIssued>(`/users/${id}/reset-link`, { method: 'POST' }),
  /** Whose password the link would change — read before showing the form. */
  resetTarget: (token: string) =>
    request<PasswordResetTarget>(`/auth/reset/${encodeURIComponent(token)}`),
  resetPassword: (token: string, password: string) =>
    request<void>('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) }),

  listSources: (page?: PageQuery) => request<Page<SourcePublic>>(`/sources${qs({ ...page })}`),
  createSource: (input: CreateSourceInput) =>
    request<SourcePublic>('/sources', { method: 'POST', body: JSON.stringify(input) }),
  updateSource: (id: string, input: UpdateSourceInput) =>
    request<SourcePublic>(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteSource: (id: string) => request<void>(`/sources/${id}`, { method: 'DELETE' }),
  testSource: (id: string) =>
    request<ConnectionTestResult>(`/sources/${id}/test`, { method: 'POST' }),
  /**
   * Every repo the owner exposes, scope or no scope — what the source form
   * ticks its boxes against. Costs one provider call, so it is asked for when
   * the selection is opened rather than with the source itself.
   */
  sourceRepositories: (id: string, signal?: AbortSignal) =>
    request<RepositoryRef[]>(`/sources/${id}/repositories`, { signal }),
  /**
   * Issues the webhook secret — and rotates it if one existed. The response is
   * the only place the value is ever readable.
   */
  issueWebhookSecret: (id: string) =>
    request<WebhookSetup>(`/sources/${id}/webhook`, { method: 'POST' }),
  /**
   * Collects a source right away. On a stored source this also fills the store,
   * which is what a fresh switch to that mode is waiting on — otherwise the
   * board stays empty until the next scheduled run.
   */
  /**
   * Makes a source the one a reader lands on when the address names none. At
   * most one across the install, so this clears whichever held it.
   */
  makeDefaultSource: (id: string) =>
    request<SourcePublic>(`/sources/${id}/default`, { method: 'POST' }),
  collectSource: (id: string) =>
    request<MetricSnapshotPublic[]>(`/sources/${id}/collect`, { method: 'POST' }),
  /**
   * Queues a deep re-read of a stored source and returns what to follow it by.
   *
   * `historyDays` becomes the source's depth, it does not apply to this run
   * alone: the purge sweeps each source at the depth the source states, so a
   * run reaching deeper than that would be swept away shortly after paying for
   * itself. Omitted keeps whatever the source already states.
   *
   * Rejects with 409 while a re-read of the same source is still in flight.
   */
  refreshSource: (id: string, historyDays?: number) =>
    request<JobHandle>(`/sources/${id}/refresh`, {
      method: 'POST',
      body: JSON.stringify(historyDays === undefined ? {} : { historyDays }),
    }),
  /**
   * Queues a replay of the DORA metric history over `days` days.
   *
   * Omitting the depth falls back to the DORA window. Rejects with 409 while a
   * replay of the same source is still in flight. Unlike a re-read, the depth
   * is not written on the source: it says how far back to restate readings,
   * not how deep to ingest.
   */
  rebuildMetrics: (id: string, days?: number) =>
    request<JobHandle>(`/sources/${id}/dora/rebuild`, {
      method: 'POST',
      body: JSON.stringify(days === undefined ? {} : { days }),
    }),
  /** Where a queued job got to. `unknown` once the queue has evicted it. */
  jobStatus: (handle: JobHandle, signal?: AbortSignal) =>
    request<JobStatus>(`/jobs/${handle.queue}/${handle.id}`, { signal }),
  /** `signal` lets a newer filter cancel the request this one supersedes. */
  live: (sourceId: string, query: DashboardLiveQuery = {}, signal?: AbortSignal) =>
    request<DashboardLive>(
      `/dashboard/${sourceId}/live` +
        qs({
          repos: query.repos?.length ? query.repos : undefined,
          prsLimit: query.prs?.limit,
          prsOffset: query.prs?.offset,
          pipelinesLimit: query.pipelines?.limit,
          pipelinesOffset: query.pipelines?.offset,
          environmentsLimit: query.environments?.limit,
          environmentsOffset: query.environments?.offset,
        }),
      { signal },
    ),

  /** The whole catalogue: rules are global, sources opt into them. */
  listEnvRules: (target: RuleTarget, page?: PageQuery) =>
    request<Page<EnvRulePublic>>(`/env-rules${qs({ target, ...page })}`),
  createEnvRule: (input: CreateEnvRuleInput) =>
    request<EnvRulePublic>('/env-rules', { method: 'POST', body: JSON.stringify(input) }),
  updateEnvRule: (id: string, input: UpdateEnvRuleInput) =>
    request<EnvRulePublic>(`/env-rules/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteEnvRule: (id: string) => request<void>(`/env-rules/${id}`, { method: 'DELETE' }),
  classifyEnv: (sourceId: string, name: string, target: RuleTarget, repo?: string) =>
    request<ClassifiedEnvironment>(`/sources/${sourceId}/env-rules/classify`, {
      method: 'POST',
      body: JSON.stringify({ name, target, repo }),
    }),
  /**
   * Stateless classification: a name against an ad-hoc rule set. The repo is
   * what the rules confined to one are matched against; without it they stand
   * down, exactly as in the views that classify a name across repos.
   */
  previewEnvRules: (name: string, rules: CreateEnvRuleInput[], repo?: string) =>
    request<ClassifiedEnvironment>('/env-rules/preview', {
      method: 'POST',
      body: JSON.stringify({ name, rules, repo }),
    }),

  /** The whole catalogue, like the classification rules: sources opt into it. */
  listEnvUrlRules: (page?: PageQuery) =>
    request<Page<EnvUrlRulePublic>>(`/env-url-rules${qs({ ...page })}`),
  createEnvUrlRule: (input: CreateEnvUrlRuleInput) =>
    request<EnvUrlRulePublic>('/env-url-rules', { method: 'POST', body: JSON.stringify(input) }),
  updateEnvUrlRule: (id: string, input: UpdateEnvUrlRuleInput) =>
    request<EnvUrlRulePublic>(`/env-url-rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteEnvUrlRule: (id: string) => request<void>(`/env-url-rules/${id}`, { method: 'DELETE' }),
  /**
   * What a candidate rule set makes of one environment. Worth asking before
   * saving: an address that comes out wrong is indistinguishable, on the page,
   * from a platform that published none.
   */
  previewEnvUrl: (input: EnvUrlPreviewInput) =>
    request<EnvUrlPreview>('/env-url-rules/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Declared environments belong to a source, unlike the rules. */
  listManualEnvironments: (sourceId: string, page?: PageQuery) =>
    request<Page<ManualEnvironmentPublic>>(
      `/sources/${sourceId}/manual-environments${qs({ ...page })}`,
    ),
  createManualEnvironment: (sourceId: string, input: CreateManualEnvironmentInput) =>
    request<ManualEnvironmentPublic>(`/sources/${sourceId}/manual-environments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateManualEnvironment: (id: string, input: UpdateManualEnvironmentInput) =>
    request<ManualEnvironmentPublic>(`/manual-environments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteManualEnvironment: (id: string) =>
    request<void>(`/manual-environments/${id}`, { method: 'DELETE' }),

  /** The whole catalogue, like the classification rules: sources opt into it. */
  listVersionRules: (page?: PageQuery) =>
    request<Page<VersionRulePublic>>(`/version-rules${qs({ ...page })}`),
  createVersionRule: (input: CreateVersionRuleInput) =>
    request<VersionRulePublic>('/version-rules', { method: 'POST', body: JSON.stringify(input) }),
  updateVersionRule: (id: string, input: UpdateVersionRuleInput) =>
    request<VersionRulePublic>(`/version-rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteVersionRule: (id: string) => request<void>(`/version-rules/${id}`, { method: 'DELETE' }),
  /**
   * Runs a candidate rule over one response, saving nothing. The backend is the
   * only place a path is resolved: the editor sends the template and gets back
   * both the tree it builds paths from and what the template produced, so the
   * two can never disagree about what a path means.
   */
  previewVersionRule: (input: VersionPreviewInput) =>
    request<VersionPreview>('/version-rules/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** What this source's environments are running, as last read. */
  sourceVersions: (sourceId: string, signal?: AbortSignal) =>
    request<EnvironmentVersion[]>(`/sources/${sourceId}/versions`, { signal }),
  /**
   * Every version one environment has run, newest first. Asked for a pair
   * rather than a source: the same environment name in two repos is two
   * different stories.
   */
  versionHistory: (
    sourceId: string,
    pair: { repo: string; environment: string },
    page?: PageQuery,
    signal?: AbortSignal,
  ) =>
    request<VersionHistory>(
      `/sources/${sourceId}/versions/history${qs({ ...pair, ...page })}`,
      { signal },
    ),
  /** Reads them again now, rather than at the next collection. */
  probeSourceVersions: (sourceId: string) =>
    request<VersionProbeOutcome>(`/sources/${sourceId}/versions/probe`, { method: 'POST' }),

  /** Every rule; each names the tracker it belongs to. */
  listTicketRules: (page?: PageQuery) =>
    request<Page<TicketRulePublic>>(`/ticket-rules${qs({ ...page })}`),
  createTicketRule: (input: CreateTicketRuleInput) =>
    request<TicketRulePublic>('/ticket-rules', { method: 'POST', body: JSON.stringify(input) }),
  updateTicketRule: (id: string, input: UpdateTicketRuleInput) =>
    request<TicketRulePublic>(`/ticket-rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTicketRule: (id: string) => request<void>(`/ticket-rules/${id}`, { method: 'DELETE' }),
  /** Runs every saved rule over a sample of each text a rule may read. */
  previewTicketRules: (sample: {
    branch: string;
    title: string;
    body: string;
    commit: string;
    owner?: string;
    repo?: string;
  }) => request<TicketRef[]>('/ticket-rules/preview', { method: 'POST', body: JSON.stringify(sample) }),

  /** Queue counts, schedules and reachability, read at the instant. */
  jobs: (signal?: AbortSignal) => request<JobsSnapshot>('/jobs', { signal }),
  /** What is running, and what is queued behind it. */
  runningJobs: (query?: FailedJobsQuery, signal?: AbortSignal) =>
    request<Page<JobRunning>>(`/jobs/running${qs({ ...query })}`, { signal }),
  /** Failed jobs, newest first, across the queues unless one is named. */
  failedJobs: (query?: FailedJobsQuery, signal?: AbortSignal) =>
    request<Page<JobFailure>>(`/jobs/failures${qs({ ...query })}`, { signal }),
  /** Runs that completed having given up on part of their work. */
  degradedJobs: (query?: FailedJobsQuery, signal?: AbortSignal) =>
    request<Page<JobWarning>>(`/jobs/degraded${qs({ ...query })}`, { signal }),
  retryJob: (queue: QueueName, id: string) =>
    request<void>(`/jobs/${queue}/${id}/retry`, { method: 'POST' }),
  discardJob: (queue: QueueName, id: string) =>
    request<void>(`/jobs/${queue}/${id}`, { method: 'DELETE' }),

  /**
   * How much history every source actually holds, all of them at once — the
   * same shape as the quotas below, and read on the same page.
   */
  listCoverage: () => request<SourceCoverage[]>('/coverage'),

  /** Every metered bucket, all subjects at once — see the quotas controller. */
  listQuotas: () => request<ApiQuotaPublic[]>('/quotas'),
  /** The ceilings declared by hand, for the instances that meter nothing. */
  listBudgets: () => request<ApiBudgetPublic[]>('/quotas/budgets'),
  declareBudget: (sourceId: string, input: ApiBudgetInput) =>
    request<ApiBudgetPublic>(`/quotas/sources/${sourceId}/budget`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  withdrawBudget: (sourceId: string) =>
    request<void>(`/quotas/sources/${sourceId}/budget`, { method: 'DELETE' }),

  listTrackers: (page?: PageQuery) =>
    request<Page<TrackerPublic>>(`/trackers${qs({ ...page })}`),
  createTracker: (input: CreateTrackerInput) =>
    request<TrackerPublic>('/trackers', { method: 'POST', body: JSON.stringify(input) }),
  updateTracker: (id: string, input: UpdateTrackerInput) =>
    request<TrackerPublic>(`/trackers/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteTracker: (id: string) => request<void>(`/trackers/${id}`, { method: 'DELETE' }),

  listLlmProviders: (page?: PageQuery) =>
    request<Page<LlmProviderPublic>>(`/llm-providers${qs({ ...page })}`),
  createLlmProvider: (input: CreateLlmProviderInput) =>
    request<LlmProviderPublic>('/llm-providers', { method: 'POST', body: JSON.stringify(input) }),
  updateLlmProvider: (id: string, input: UpdateLlmProviderInput) =>
    request<LlmProviderPublic>(`/llm-providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteLlmProvider: (id: string) => request<void>(`/llm-providers/${id}`, { method: 'DELETE' }),
  /** Spends one call to prove the key, the model and the endpoint together. */
  testLlmProvider: (id: string) =>
    request<ConnectionTestResult>(`/llm-providers/${id}/test`, { method: 'POST' }),

  /**
   * Everything the landing page reads, in one call. No page window: the
   * environments come back whole because the page pivots them, and half a
   * pivot is not half an answer.
   */
  overview: (sourceId: string, query: OverviewQuery = {}, signal?: AbortSignal) =>
    request<OverviewReport>(
      `/overview/${sourceId}` +
        qs({
          from: query.from,
          to: query.to,
          windowDays: query.windowDays,
          repos: query.repos?.length ? query.repos : undefined,
          meta: query.meta || undefined,
          // The API takes `key:value` pairs, repeatable — same as DORA.
          dimension: Object.entries(query.dimensions ?? {}).map(([k, v]) => `${k}:${v}`),
        }),
      { signal },
    ),

  /**
   * Incidents over a period. Read on its own rather than folded into the
   * overview: incidents live in a tracker, on another platform, with a budget
   * of its own — only the view that shows them should pay for them.
   */
  incidents: (
    sourceId: string,
    query: { from?: string; to?: string; windowDays?: number; repos?: string[] } = {},
    signal?: AbortSignal,
  ) =>
    request<Incident[]>(
      `/sources/${sourceId}/incidents` +
        qs({
          from: query.from,
          to: query.to,
          windowDays: query.windowDays,
          repos: query.repos?.length ? query.repos : undefined,
        }),
      { signal },
    ),

  /** Deployments over a period, classified and filtered. */
  deployments: (sourceId: string, query: DeploymentsQuery = {}, signal?: AbortSignal) =>
    request<DeploymentReport>(
      `/sources/${sourceId}/deployments` +
        qs({
          limit: query.limit,
          offset: query.offset,
          from: query.from,
          to: query.to,
          windowDays: query.windowDays,
          repos: query.repos?.length ? query.repos : undefined,
          environment: query.environments?.length ? query.environments : undefined,
          status: query.statuses?.length ? query.statuses : undefined,
          // The API takes `key:value` pairs, repeatable — same as DORA.
          dimension: Object.entries(query.dimensions ?? {}).map(([k, v]) => `${k}:${v}`),
        }),
      { signal },
    ),
  /**
   * What one deployment carried. The period travels with it: the base is looked
   * for among the deployments of that window, so a detail opened from a list
   * answers about the same window the list was showing.
   */
  deploymentChanges: (
    sourceId: string,
    deploymentId: string,
    query: {
      repo: string;
      base: DeploymentBase;
      /** The ref to compare against, when `base` is `ref`. */
      ref?: string;
      from?: string;
      to?: string;
      windowDays?: number;
    },
    signal?: AbortSignal,
  ) =>
    request<DeploymentChanges>(
      `/sources/${sourceId}/deployments/${encodeURIComponent(deploymentId)}/changes` +
        qs({
          repo: query.repo,
          base: query.base,
          ref: query.ref,
          from: query.from,
          to: query.to,
          windowDays: query.windowDays,
        }),
      { signal },
    ),

  /**
   * The archive of what deployments carried. Reads stored rows and nothing
   * else, so a history months deep answers as fast as yesterday's.
   */
  changelogs: (sourceId: string, query: ChangelogsQuery = {}, signal?: AbortSignal) =>
    request<ChangelogReport>(
      `/sources/${sourceId}/changelogs` +
        qs({
          repo: query.repos?.length ? query.repos : undefined,
          environment: query.environments?.length ? query.environments : undefined,
          search: query.search || undefined,
          from: query.from,
          to: query.to,
          limit: query.limit,
          offset: query.offset,
        }),
      { signal },
    ),
  /** One filed changelog, keyed on the deployment it describes. */
  changelog: (sourceId: string, deploymentId: string, signal?: AbortSignal) =>
    request<DeploymentChangelog>(
      `/sources/${sourceId}/changelogs/${encodeURIComponent(deploymentId)}`,
      { signal },
    ),

  /** Repos in a source's scope — free on a stored source, one call on a live one. */
  sourceRepos: (sourceId: string, signal?: AbortSignal) =>
    request<string[]>(`/sources/${sourceId}/repos`, { signal }),
  /**
   * Tags of a repo, for whoever picks the range a release is cut from.
   * `tagPattern` narrows them to one component's releases, on a repo that tags
   * several — without it the picker offers tags the defaults would never pick.
   */
  tags: (sourceId: string, repo: string, tagPattern?: string, signal?: AbortSignal) =>
    request<Tag[]>(`/sources/${sourceId}/tags${qs({ repo, tagPattern })}`, { signal }),
  /** Branches of the same repo — a range bound may be either. */
  branches: (sourceId: string, repo: string, signal?: AbortSignal) =>
    request<Branch[]>(`/sources/${sourceId}/branches${qs({ repo })}`, { signal }),
  /** Walks a history, so as expensive as a DORA report — cancellable for that reason. */
  releaseNotes: (
    sourceId: string,
    query: { repo: string; from?: string; to?: string; tagPattern?: string },
    signal?: AbortSignal,
  ) =>
    request<ReleaseNotes>(
      `/sources/${sourceId}/release-notes` +
        qs({
          repo: query.repo,
          from: query.from,
          to: query.to,
          tagPattern: query.tagPattern,
        }),
      { signal },
    ),
  /** Bound to no source: the notes travel in the body, already generated. */
  rewriteReleaseNotes: (input: RewriteRequest, signal?: AbortSignal) =>
    request<RewriteResult>('/release-notes/rewrite', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),

  settings: () => request<AppSettings>('/settings'),
  updateSettings: (input: Partial<AppSettings>) =>
    request<AppSettings>('/settings', { method: 'PATCH', body: JSON.stringify(input) }),

  /** `signal` lets a newer filter cancel the request this one supersedes. */
  dora: (sourceId: string, query: DoraQuery = {}, signal?: AbortSignal) =>
    request<DoraReport>(
      `/sources/${sourceId}/dora` +
        qs({
          limit: query.limit,
          offset: query.offset,
          from: query.from,
          to: query.to,
          windowDays: query.windowDays,
          repos: query.repos?.length ? query.repos : undefined,
          // The API takes `key:value` pairs, repeatable.
          dimension: Object.entries(query.dimensions ?? {}).map(([k, v]) => `${k}:${v}`),
        }),
      { signal },
    ),
  /**
   * The events behind one metric, paginated — all of them, over the same period
   * and slice as the value. The reading itself carries only its most recent
   * few, which is what a list somebody pages through cannot be.
   */
  doraSamples: (
    sourceId: string,
    query: DoraQuery & { metric: DoraMetric },
    page?: PageQuery,
    signal?: AbortSignal,
  ) =>
    request<Page<DoraSample>>(
      `/sources/${sourceId}/dora/samples` +
        qs({
          metric: query.metric,
          from: query.from,
          to: query.to,
          windowDays: query.windowDays,
          dimension: Object.entries(query.dimensions ?? {}).map(([k, v]) => `${k}:${v}`),
          ...page,
        }),
      { signal },
    ),
  /**
   * The given metrics over a period, each folded over the filter and bucketed
   * by day. One series per metric asked for, in the order asked — a metric with
   * no history answers with no points rather than being left out.
   */
  metricSeries: (
    sourceId: string,
    query: {
      metrics: string[];
      dimensions?: Record<string, string>;
      from?: string;
      to?: string;
      /** The rolling window, when the period was picked as one — usually. */
      windowDays?: number;
    },
    signal?: AbortSignal,
  ) =>
    request<MetricSeries[]>(
      `/sources/${sourceId}/metrics/series` +
        qs({
          metric: query.metrics,
          dimension: Object.entries(query.dimensions ?? {}).map(([k, v]) => `${k}:${v}`),
          from: query.from,
          to: query.to,
          windowDays: query.windowDays,
        }),
      { signal },
    ),
  metrics: (sourceId: string, query?: MetricsQuery, signal?: AbortSignal) =>
    request<Page<MetricSnapshotPublic>>(`/sources/${sourceId}/metrics${qs({ ...query })}`, {
      signal,
    }),
};
