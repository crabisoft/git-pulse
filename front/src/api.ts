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
  SourceMode,
  SourcePublic,
  WebhookSetup,
  DashboardLive,
  ConnectionTestResult,
  CodedMessage,
  EnvRulePublic,
  ClassifiedEnvironment,
  Branch,
  DeploymentBase,
  DeploymentChanges,
  DeploymentReport,
  DoraReport,
  LlmKind,
  PipelineStatus,
  LlmProviderPublic,
  ReleaseNotes,
  RepositoryRef,
  RewriteRequest,
  RewriteResult,
  Tag,
  MetricBucket,
  MetricSeries,
  MetricSnapshotPublic,
  Page,
  RuleTarget,
  ScopeRules,
  TicketRef,
  TicketRulePublic,
  TrackerKind,
  TrackerPublic,
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
}

/** Every field is optional; omitted ones keep their stored value. */
export type UpdateEnvRuleInput = Partial<CreateEnvRuleInput>;

export interface CreateTicketRuleInput {
  trackerId: string;
  name: string;
  pattern: string;
  priority?: number;
}

export type UpdateTicketRuleInput = Partial<CreateTicketRuleInput>;

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
  updateMe: (input: { name?: string; password?: string; currentPassword?: string }) =>
    request<AuthState>('/auth/me', { method: 'PATCH', body: JSON.stringify(input) }),
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
  collectSource: (id: string) =>
    request<MetricSnapshotPublic[]>(`/sources/${id}/collect`, { method: 'POST' }),
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
  classifyEnv: (sourceId: string, name: string, target: RuleTarget) =>
    request<ClassifiedEnvironment>(`/sources/${sourceId}/env-rules/classify`, {
      method: 'POST',
      body: JSON.stringify({ name, target }),
    }),
  /** Stateless classification: a name against an ad-hoc rule set. */
  previewEnvRules: (name: string, rules: CreateEnvRuleInput[]) =>
    request<ClassifiedEnvironment>('/env-rules/preview', {
      method: 'POST',
      body: JSON.stringify({ name, rules }),
    }),

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
  /** Runs every saved rule over a sample branch and title. */
  previewTicketRules: (sample: {
    branch: string;
    title: string;
    owner?: string;
    repo?: string;
  }) => request<TicketRef[]>('/ticket-rules/preview', { method: 'POST', body: JSON.stringify(sample) }),

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

  /** Repos in a source's scope — free on a stored source, one call on a live one. */
  sourceRepos: (sourceId: string, signal?: AbortSignal) =>
    request<string[]>(`/sources/${sourceId}/repos`, { signal }),
  /** Tags of a repo, for whoever picks the range a release is cut from. */
  tags: (sourceId: string, repo: string, signal?: AbortSignal) =>
    request<Tag[]>(`/sources/${sourceId}/tags${qs({ repo })}`, { signal }),
  /** Branches of the same repo — a range bound may be either. */
  branches: (sourceId: string, repo: string, signal?: AbortSignal) =>
    request<Branch[]>(`/sources/${sourceId}/branches${qs({ repo })}`, { signal }),
  /** Walks a history, so as expensive as a DORA report — cancellable for that reason. */
  releaseNotes: (
    sourceId: string,
    query: { repo: string; from?: string; to?: string },
    signal?: AbortSignal,
  ) =>
    request<ReleaseNotes>(
      `/sources/${sourceId}/release-notes` +
        qs({ repo: query.repo, from: query.from, to: query.to }),
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
  /** One metric, one dimension combination, bucketed for a chart. */
  metricSeries: (
    sourceId: string,
    query: {
      metric: string;
      dimensions?: Record<string, string>;
      from?: string;
      to?: string;
      bucket?: MetricBucket;
    },
    signal?: AbortSignal,
  ) =>
    request<MetricSeries>(
      `/sources/${sourceId}/metrics/series` +
        qs({
          metric: query.metric,
          dimension: Object.entries(query.dimensions ?? {}).map(([k, v]) => `${k}:${v}`),
          from: query.from,
          to: query.to,
          bucket: query.bucket,
        }),
      { signal },
    ),
  metrics: (sourceId: string, query?: MetricsQuery, signal?: AbortSignal) =>
    request<Page<MetricSnapshotPublic>>(`/sources/${sourceId}/metrics${qs({ ...query })}`, {
      signal,
    }),
};
