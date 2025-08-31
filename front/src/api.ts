import type {
  AppSettings,
  SourcePublic,
  DashboardLive,
  ConnectionTestResult,
  CodedMessage,
  EnvRulePublic,
  ClassifiedEnvironment,
  DoraResult,
  MetricSnapshotPublic,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (e) {
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

export interface CreateSourceInput {
  name: string;
  kind: 'github' | 'gitlab';
  baseUrl: string;
  authKind: 'token' | 'app';
  secret?: string;
  app?: { appId: string; privateKey: string; installationId: string };
  scope: { owner: string; include?: string[]; exclude?: string[] };
}

/** Every field is optional; omitting the secret keeps the stored one. */
export type UpdateSourceInput = Partial<CreateSourceInput>;

export interface CreateEnvRuleInput {
  name: string;
  pattern: string;
  kind: 'simple' | 'meta';
  priority?: number;
}

/** Every field is optional; omitted ones keep their stored value. */
export type UpdateEnvRuleInput = Partial<CreateEnvRuleInput>;

export const api = {
  listSources: () => request<SourcePublic[]>('/sources'),
  createSource: (input: CreateSourceInput) =>
    request<SourcePublic>('/sources', { method: 'POST', body: JSON.stringify(input) }),
  updateSource: (id: string, input: UpdateSourceInput) =>
    request<SourcePublic>(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteSource: (id: string) => request<void>(`/sources/${id}`, { method: 'DELETE' }),
  testSource: (id: string) =>
    request<ConnectionTestResult>(`/sources/${id}/test`, { method: 'POST' }),
  live: (sourceId: string) => request<DashboardLive>(`/dashboard/${sourceId}/live`),

  listEnvRules: (sourceId: string) =>
    request<EnvRulePublic[]>(`/sources/${sourceId}/env-rules`),
  createEnvRule: (sourceId: string, input: CreateEnvRuleInput) =>
    request<EnvRulePublic>(`/sources/${sourceId}/env-rules`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateEnvRule: (id: string, input: UpdateEnvRuleInput) =>
    request<EnvRulePublic>(`/env-rules/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteEnvRule: (id: string) => request<void>(`/env-rules/${id}`, { method: 'DELETE' }),
  classifyEnv: (sourceId: string, name: string) =>
    request<ClassifiedEnvironment>(`/sources/${sourceId}/env-rules/classify`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  /** Stateless classification: a name against an ad-hoc rule set. */
  previewEnvRules: (name: string, rules: CreateEnvRuleInput[]) =>
    request<ClassifiedEnvironment>('/env-rules/preview', {
      method: 'POST',
      body: JSON.stringify({ name, rules }),
    }),

  settings: () => request<AppSettings>('/settings'),
  updateSettings: (input: Partial<AppSettings>) =>
    request<AppSettings>('/settings', { method: 'PATCH', body: JSON.stringify(input) }),

  dora: (sourceId: string) => request<DoraResult[]>(`/sources/${sourceId}/dora`),
  metrics: (sourceId: string) => request<MetricSnapshotPublic[]>(`/sources/${sourceId}/metrics`),
};
