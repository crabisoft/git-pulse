import { afterEach, describe, expect, it, vi } from 'vitest';
import { octokitFor } from './github.connector';
import { gitlabFor } from './gitlab.connector';
import type { ConnectorContext } from './source-connector.interface';
import type { QuotaSample } from '../../api-quota/rate-limit-headers';

/**
 * Both clients are metered by wrapping what they already have — Octokit's
 * request hooks, gitbeaker's built requesters. Neither is a documented
 * contract, so these suites exercise the real clients against a stubbed
 * transport: an upgrade that moves the seam has to fail here rather than in
 * production, where the only symptom would be a gauge that stopped moving.
 */

function respondWith(headers: Record<string, string>, status = 200) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 1, default_branch: 'main' }), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function contextFor(
  kind: 'github' | 'gitlab',
  onQuota?: (s: QuotaSample | null) => void,
): ConnectorContext {
  return {
    baseUrl: kind === 'github' ? 'https://github.example.com' : 'https://gitlab.example.com',
    auth: { kind: 'token', token: 'secret' },
    scope: { owner: 'acme' },
    onQuota,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('GitHub metering', () => {
  it('reports the counters of a call the connector makes', async () => {
    const samples: (QuotaSample | null)[] = [];
    respondWith({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-used': '17',
      'x-ratelimit-reset': '1774526400',
      'x-ratelimit-resource': 'core',
    });

    await octokitFor(contextFor('github', (s) => samples.push(s))).rest.repos.get({
      owner: 'acme',
      repo: 'widget',
    });

    expect(samples).toEqual([
      { bucket: 'core', limit: 5000, used: 17, resetAt: new Date(1774526400000), windowSec: 3600 },
    ]);
  });

  it('reports them from a refusal too, which is when the budget is spent', async () => {
    const samples: (QuotaSample | null)[] = [];
    respondWith(
      {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-used': '5000',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1774526400',
      },
      403,
    );

    const gh = octokitFor(contextFor('github', (s) => samples.push(s)));
    await expect(gh.rest.repos.get({ owner: 'acme', repo: 'widget' })).rejects.toThrow();

    expect(samples).toHaveLength(1);
    expect(samples[0]?.used).toBe(5000);
  });

  it('stays usable with nobody metering', async () => {
    respondWith({ 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1774526400' });

    const gh = octokitFor(contextFor('github'));
    await expect(gh.rest.repos.get({ owner: 'acme', repo: 'widget' })).resolves.toBeDefined();
  });
});

describe('GitLab metering', () => {
  it('reports the counters of a call the connector makes', async () => {
    const samples: (QuotaSample | null)[] = [];
    respondWith({
      'ratelimit-limit': '600',
      'ratelimit-observed': '73',
      'ratelimit-reset': '1774526460',
    });

    await gitlabFor(contextFor('gitlab', (s) => samples.push(s))).Projects.show('acme/widget');

    expect(samples).toEqual([
      { bucket: 'rest', limit: 600, used: 73, resetAt: new Date(1774526460000), windowSec: 60 },
    ]);
  });

  it('reports the call itself when the instance meters nothing', async () => {
    const samples: (QuotaSample | null)[] = [];
    respondWith({});

    await gitlabFor(contextFor('gitlab', (s) => samples.push(s))).Projects.show('acme/widget');

    // Rate limiting can be switched off on a self-hosted instance. No header
    // means no measurement — which must not surface as an empty budget, but
    // must not look like no call either: it is what a declared budget counts.
    expect(samples).toEqual([null]);
  });

  it('stays usable with nobody metering', async () => {
    respondWith({ 'ratelimit-limit': '600', 'ratelimit-reset': '1774526460' });

    await expect(gitlabFor(contextFor('gitlab')).Projects.show('acme/widget')).resolves.toBeDefined();
  });
});
