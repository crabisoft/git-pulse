import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, apiErrorInfo, ApiError, isAbort } from './api';

/** Captures the request the client builds, and answers whatever the test wants. */
function stubFetch(response: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: 'stubbed',
    json: async () => response.body ?? {},
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const urlOf = (fetchMock: ReturnType<typeof stubFetch>) => new URL(fetchMock.mock.calls[0][0], 'http://x');

afterEach(() => vi.unstubAllGlobals());

describe('DORA query serialisation', () => {
  it('repeats repos and spells dimensions as key:value pairs', async () => {
    const fetchMock = stubFetch();
    await api.dora('s1', {
      repos: ['api', 'web'],
      dimensions: { app: 'Extranet', type: 'Prod' },
    });

    const params = urlOf(fetchMock).searchParams;
    // The API reads a repeated parameter; a single joined string would land in
    // one repo literally named "api,web".
    expect(params.getAll('repos')).toEqual(['api', 'web']);
    expect(params.getAll('dimension')).toEqual(['app:Extranet', 'type:Prod']);
  });

  it('drops what was left undefined instead of sending it empty', async () => {
    const fetchMock = stubFetch();
    await api.dora('s1', { windowDays: 90 });

    const params = urlOf(fetchMock).searchParams;
    expect(params.get('windowDays')).toBe('90');
    expect(params.has('from')).toBe(false);
    expect(params.has('to')).toBe(false);
  });

  it('omits an empty repo list, which the API reads as "every repo"', async () => {
    const fetchMock = stubFetch();
    await api.dora('s1', { repos: [], dimensions: {} });

    const params = urlOf(fetchMock).searchParams;
    expect(params.has('repos')).toBe(false);
    expect(params.has('dimension')).toBe(false);
  });

  it('hands the signal down so a superseded request can be dropped', async () => {
    const fetchMock = stubFetch();
    const controller = new AbortController();
    await api.dora('s1', {}, controller.signal);

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe('error mapping', () => {
  it('carries the code and params the API answered', async () => {
    stubFetch({
      ok: false,
      status: 400,
      body: { code: 'errors.settings.outOfRange', params: { key: 'pageSize', min: 1, max: 200 } },
    });

    const error = await api.settings().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(apiErrorInfo(error)).toEqual({
      code: 'errors.settings.outOfRange',
      params: { key: 'pageSize', min: 1, max: 200 },
    });
  });

  it('falls back to a status code when the body carries none', async () => {
    stubFetch({ ok: false, status: 502, body: null });
    const error = await api.settings().catch((e: unknown) => e);
    expect(apiErrorInfo(error).code).toBe('errors.http');
  });

  it('turns an unreachable API into a translatable network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await api.settings().catch((e: unknown) => e);
    expect(apiErrorInfo(error).code).toBe('errors.network');
  });

  it('lets an abort through untouched, being a decision and not an incident', async () => {
    const aborted = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(aborted));

    const error = await api.settings().catch((e: unknown) => e);
    // Wrapped as errors.network, a cancellation would surface as a red banner.
    expect(isAbort(error)).toBe(true);
    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe('isAbort', () => {
  it('does not mistake an ordinary failure for a cancellation', () => {
    expect(isAbort(new Error('socket hang up'))).toBe(false);
    expect(isAbort(new ApiError('errors.network'))).toBe(false);
  });
});
