import type {
  ApiQuotaPublic,
  AppSettings,
  SourcePublic,
  DashboardLive,
  ConnectionTestResult,
  CodedMessage,
  EnvRulePublic,
  ClassifiedEnvironment,
  DoraReport,
  MetricSnapshotPublic,
  Page,
  RuleTarget,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError('errors.network', { error: e instanceof Error ? e.message : String(e) });
  }

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

export interface CreateSourceInput {
  name: string;
  kind: 'github' | 'gitlab';
  baseUrl: string;
  authKind: 'token' | 'app';
  secret?: string;
  app?: { appId: string; privateKey: string; installationId: string };
  scope: { owner: string; include?: string[]; exclude?: string[] };
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

export const api = {
  listSources: (page?: PageQuery) => request<Page<SourcePublic>>(`/sources${qs({ ...page })}`),
  createSource: (input: CreateSourceInput) =>
    request<SourcePublic>('/sources', { method: 'POST', body: JSON.stringify(input) }),
  updateSource: (id: string, input: UpdateSourceInput) =>
    request<SourcePublic>(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteSource: (id: string) => request<void>(`/sources/${id}`, { method: 'DELETE' }),
  testSource: (id: string) =>
    request<ConnectionTestResult>(`/sources/${id}/test`, { method: 'POST' }),
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

  listTrackers: (page?: PageQuery) =>
    request<Page<TrackerPublic>>(`/trackers${qs({ ...page })}`),
  createTracker: (input: CreateTrackerInput) =>
    request<TrackerPublic>('/trackers', { method: 'POST', body: JSON.stringify(input) }),
  updateTracker: (id: string, input: UpdateTrackerInput) =>
    request<TrackerPublic>(`/trackers/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteTracker: (id: string) => request<void>(`/trackers/${id}`, { method: 'DELETE' }),

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
  metrics: (sourceId: string, query?: MetricsQuery, signal?: AbortSignal) =>
    request<Page<MetricSnapshotPublic>>(`/sources/${sourceId}/metrics${qs({ ...query })}`, {
      signal,
    }),
};
