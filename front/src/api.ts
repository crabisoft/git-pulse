import type { SourcePublic, DashboardLive } from '@repo/shared';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001') + '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} — ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface CreateSourceInput {
  name: string;
  kind: 'github' | 'gitlab';
  baseUrl: string;
  authKind: 'token' | 'app';
  secret: string;
  scope: { owner: string; include?: string[]; exclude?: string[] };
}

export const api = {
  listSources: () => request<SourcePublic[]>('/sources'),
  createSource: (input: CreateSourceInput) =>
    request<SourcePublic>('/sources', { method: 'POST', body: JSON.stringify(input) }),
  deleteSource: (id: string) => request<void>(`/sources/${id}`, { method: 'DELETE' }),
  testSource: (id: string) =>
    request<{ ok: boolean; message: string }>(`/sources/${id}/test`, { method: 'POST' }),
  live: (sourceId: string) => request<DashboardLive>(`/dashboard/${sourceId}/live`),
};
