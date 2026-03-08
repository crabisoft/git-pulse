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
      dimensions: { app: 'Portal', type: 'Prod' },
    });

    const params = urlOf(fetchMock).searchParams;
    // The API reads a repeated parameter; a single joined string would land in
    // one repo literally named "api,web".
    expect(params.getAll('repos')).toEqual(['api', 'web']);
    expect(params.getAll('dimension')).toEqual(['app:Portal', 'type:Prod']);
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

describe('release notes and rewriting', () => {
  it('carries the range in the query, dropping the bounds left to default', async () => {
    const fetchMock = stubFetch();
    await api.releaseNotes('s1', { repo: 'portal-api', to: 'v2.1.0' });

    const params = urlOf(fetchMock).searchParams;
    expect(params.get('repo')).toBe('portal-api');
    expect(params.get('to')).toBe('v2.1.0');
    // Omitted means "the tag below `to`", which an empty string would not.
    expect(params.has('from')).toBe(false);
  });

  it('posts the notes rather than a range, so nothing is regenerated', async () => {
    const fetchMock = stubFetch();
    await api.rewriteReleaseNotes({ markdown: '## Release', providerId: 'p1', language: 'fr' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/release-notes/rewrite');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      markdown: '## Release',
      providerId: 'p1',
      language: 'fr',
    });
  });

  it('lets a rewriting be cancelled like any other expensive call', async () => {
    const fetchMock = stubFetch();
    const controller = new AbortController();
    await api.rewriteReleaseNotes({ markdown: '## Release' }, controller.signal);

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe('deployments query serialisation', () => {
  it('repeats each filter the API reads as a list', async () => {
    const fetchMock = stubFetch();
    await api.deployments('s1', {
      repos: ['api', 'web'],
      environments: ['prod-eu', 'prod-us'],
      statuses: ['success'],
      dimensions: { type: 'Prod' },
    });

    const params = urlOf(fetchMock).searchParams;
    expect(params.getAll('repos')).toEqual(['api', 'web']);
    expect(params.getAll('environment')).toEqual(['prod-eu', 'prod-us']);
    expect(params.getAll('status')).toEqual(['success']);
    expect(params.getAll('dimension')).toEqual(['type:Prod']);
  });

  it('omits an empty selection, which the API reads as "every one"', async () => {
    const fetchMock = stubFetch();
    await api.deployments('s1', { repos: [], environments: [], statuses: [], dimensions: {} });

    const params = urlOf(fetchMock).searchParams;
    // Sent empty, these would filter everything out instead of nothing.
    expect(params.has('repos')).toBe(false);
    expect(params.has('environment')).toBe(false);
    expect(params.has('status')).toBe(false);
    expect(params.has('dimension')).toBe(false);
  });

  it('carries the listed period into the detail, so both read the same window', async () => {
    const fetchMock = stubFetch();
    await api.deploymentChanges('s1', 'gh:api:42', {
      repo: 'api',
      base: 'previous',
      windowDays: 90,
    });

    const url = urlOf(fetchMock);
    expect(url.pathname).toContain('/deployments/gh%3Aapi%3A42/changes');
    expect(url.searchParams.get('base')).toBe('previous');
    expect(url.searchParams.get('windowDays')).toBe('90');
  });

  it('escapes a deployment id, which carries provider-shaped separators', async () => {
    const fetchMock = stubFetch();
    await api.deploymentChanges('s1', 'gl:group/sub/project:7', { repo: 'p', base: 'default' });

    // Unescaped, the slashes would open path segments of their own and the
    // route would not match at all.
    expect(urlOf(fetchMock).pathname).toContain('gl%3Agroup%2Fsub%2Fproject%3A7');
  });
});

describe('deployment comparison base', () => {
  it('carries the chosen ref alongside the base', async () => {
    const fetchMock = stubFetch();
    await api.deploymentChanges('s1', 'd1', { repo: 'api', base: 'ref', ref: 'v2.1.0' });

    const params = urlOf(fetchMock).searchParams;
    expect(params.get('base')).toBe('ref');
    expect(params.get('ref')).toBe('v2.1.0');
  });

  it('omits the ref when no base needs one', async () => {
    // Deciding when a ref is meaningful belongs to the caller; the client only
    // drops what it was not given, like every other optional parameter.
    const fetchMock = stubFetch();
    await api.deploymentChanges('s1', 'd1', { repo: 'api', base: 'previous' });
    expect(urlOf(fetchMock).searchParams.has('ref')).toBe(false);
  });

  it('escapes a ref that carries path separators', async () => {
    const fetchMock = stubFetch();
    await api.deploymentChanges('s1', 'd1', { repo: 'api', base: 'ref', ref: 'release/3.0' });
    // Read back through URLSearchParams, so what matters is it survives intact.
    expect(urlOf(fetchMock).searchParams.get('ref')).toBe('release/3.0');
  });
});
