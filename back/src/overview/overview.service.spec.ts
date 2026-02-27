import { describe, expect, it, vi } from 'vitest';
import type { PipelineStatus, PullRequest } from '@repo/shared';
import { OverviewService } from './overview.service';
import type { CollectedSource } from '../dashboard/dashboard.service';
import type { DimensionedDeployment } from '../dashboard/environments';

/**
 * A deployment already resolved against the rules — what the overview folds
 * environments from. Rows no longer come in ready-made: a row is what its
 * deployments have in common, which is the only way filtering one dimension
 * can narrow the repos a row covers.
 */
function deployment(
  environmentName: string,
  attributes: Record<string, string>,
  over: Partial<DimensionedDeployment> = {},
): DimensionedDeployment {
  return {
    id: `${environmentName}-${over.repo ?? 'acme/api'}-${over.createdAt ?? '1'}`,
    repo: 'acme/api',
    environment: environmentName,
    ref: 'v2.14.1',
    status: 'success' as PipelineStatus,
    createdAt: '2026-07-30T10:00:00.000Z',
    environmentUrl: null,
    url: null,
    attributes,
    metaEnvironments: [],
    ...over,
  };
}

function pullRequest(ageHours: number): PullRequest {
  return {
    id: `pr-${ageHours}`,
    repo: 'acme/api',
    repoUrl: 'https://example.test/acme/api',
    number: 1,
    title: 'Add the thing',
    author: 'someone',
    state: 'open',
    url: 'https://example.test/acme/api/1',
    headRef: 'feat/thing',
    reviewers: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    mergedAt: null,
    ageHours,
    tickets: [],
  };
}

function build(overrides: Partial<CollectedSource> = {}) {
  const collected: CollectedSource = {
    repos: ['acme/api', 'acme/web'],
    pullRequests: [pullRequest(200), pullRequest(4)],
    pipelines: [],
    deployments: [],
    environments: [],
    mode: 'stored',
    syncedAt: '2026-07-30T09:00:00.000Z',
    warnings: [],
    ...overrides,
  };

  const jobs = { snapshot: vi.fn().mockResolvedValue({ queues: [], observedAt: '', unreachable: null }) };
  const quotas = { list: vi.fn().mockResolvedValue([]) };

  const service = new OverviewService(
    { collect: vi.fn().mockResolvedValue(collected) } as never,
    {
      report: vi.fn().mockResolvedValue({
        results: [],
        repos: collected.repos,
        dimensions: {},
        period: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-30T00:00:00.000Z', windowDays: 30 },
      }),
    } as never,
    { snapshotsMatching: vi.fn().mockResolvedValue([]) } as never,
    jobs as never,
    quotas as never,
    { get: vi.fn().mockResolvedValue({ stalePrHours: 72 }) } as never,
  );
  return { service, jobs, quotas };
}

describe('OverviewService', () => {
  it('offers every dimension the rules produced, filter or no filter', async () => {
    // The vocabulary is what the dropdowns are built from: narrowing on one
    // client must not remove the client you would widen back to.
    const { service } = build({
      deployments: [
        deployment('prod-acme-api', { type: 'prod', client: 'acme', app: 'api' }),
        deployment('prod-globex-web', { type: 'prod', client: 'globex', app: 'web' }),
        deployment('qa-web', { app: 'web' }),
      ],
    });

    const report = await service.report('src-1', { dimension: ['client:acme'] }, true);

    expect(report.dimensions).toEqual({
      app: ['api', 'web'],
      client: ['acme', 'globex'],
      type: ['prod'],
    });
    expect(report.environments.map((e) => e.name)).toEqual(['prod-acme-api']);
  });

  it('keeps an environment no rule fully classified', async () => {
    // Hiding it would hide the rule that is missing, which is the one thing
    // the reader could act on.
    const { service } = build({
      deployments: [
        deployment('prod-acme-api', { type: 'prod', client: 'acme' }),
        deployment('qa-web', { type: 'qa' }),
      ],
    });

    const report = await service.report('src-1', { dimension: ['type:qa'] }, true);

    expect(report.environments.map((e) => e.name)).toEqual(['qa-web']);
    expect(report.environments[0].attributes.client).toBeUndefined();
  });

  it('narrows on a meta-environment as well as on an attribute', async () => {
    const { service } = build({
      deployments: [
        deployment('prod-acme-api', { type: 'prod' }, { metaEnvironments: ['production'] }),
        deployment('preprod-acme-api', { type: 'preprod' }, { metaEnvironments: ['préproduction'] }),
      ],
    });

    const report = await service.report('src-1', { meta: 'production' }, true);

    expect(report.environments.map((e) => e.name)).toEqual(['prod-acme-api']);
    expect(report.metaEnvironments).toEqual(['production', 'préproduction']);
  });

  it('carries an attribute only one repo of the source produced', async () => {
    // The case a repo-scoped rule exists for: `Prod` is deployed from one repo
    // here, so what that repo's rules say about it is what the environment is.
    const { service } = build({
      deployments: [deployment('Prod', { App: 'Billing' }, { repo: 'contoso-billing' })],
    });

    const report = await service.report('src-1', {}, true);

    expect(report.dimensions).toEqual({ App: ['Billing'] });
    expect(report.environments[0].attributes).toEqual({ App: 'Billing' });
  });

  describe('an environment two repos deploy to, classified differently', () => {
    const shared = () =>
      build({
        deployments: [
          deployment('Prod', { Env: 'Prod', App: 'Billing' }, { repo: 'contoso-billing' }),
          deployment('Prod', { Env: 'Prod', App: 'Portal' }, { repo: 'fabrikam-portal' }),
          deployment('Prod', { Env: 'Prod', App: 'Portal' }, { repo: 'fabrikam-portal' }),
        ],
      });

    it('offers both values, so neither is unpickable', async () => {
      const report = await shared().service.report('src-1', {}, true);

      expect(report.dimensions).toEqual({ App: ['Billing', 'Portal'], Env: ['Prod'] });
    });

    it('claims only what its repos agree on, unfiltered', async () => {
      const report = await shared().service.report('src-1', {}, true);

      // Saying App=Portal on a row that also covers Billing would be true
      // of neither repo; Env is the same either side, so it stays.
      const [row] = report.environments;
      expect(row.attributes).toEqual({ Env: 'Prod' });
      expect(row.repos).toEqual(['contoso-billing', 'fabrikam-portal']);
      expect(row.deployments).toBe(3);
    });

    it('narrows to the applicable repos once the attribute is picked', async () => {
      const report = await shared().service.report('src-1', { dimension: ['App:Portal'] }, true);

      const [row] = report.environments;
      // Repos, count and attributes all follow the filter: the row now
      // describes exactly the deployments it counts.
      expect(row.repos).toEqual(['fabrikam-portal']);
      expect(row.deployments).toBe(2);
      expect(row.attributes).toEqual({ Env: 'Prod', App: 'Portal' });
    });
  });

  it('counts the friction over everything collected, not over a page', async () => {
    const { service } = build({
      pipelines: [
        { id: 'a', repo: 'acme/api', ref: 'main', status: 'failed' } as never,
        { id: 'b', repo: 'acme/api', ref: 'main', status: 'running' } as never,
        { id: 'c', repo: 'acme/api', ref: 'main', status: 'success' } as never,
      ],
    });

    const report = await service.report('src-1', {}, true);

    expect(report.friction).toMatchObject({
      openPrs: 2,
      stalePrs: 1,
      failedPipelines: 1,
      runningPipelines: 1,
    });
  });

  it('keeps the last day of deployments, most recent first', async () => {
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    const { service } = build({
      deployments: [
        deployment('prod-acme-api', { type: 'prod' }, { createdAt: '2026-07-28T12:00:00.000Z' }),
        deployment('prod-acme-api', { type: 'prod' }, { createdAt: '2026-07-30T08:00:00.000Z' }),
        deployment(
          'prod-acme-api',
          { type: 'prod' },
          { createdAt: '2026-07-30T11:00:00.000Z', status: 'failed' },
        ),
      ],
    });

    const report = await service.report('src-1', {}, true);

    expect(report.events.map((e) => e.at)).toEqual([
      '2026-07-30T11:00:00.000Z',
      '2026-07-30T08:00:00.000Z',
    ]);
    expect(report.events[0].attributes).toEqual({ type: 'prod' });
    vi.useRealTimers();
  });

  it('tells a visitor how fresh the data is, and nothing about the machine room', async () => {
    // The background-jobs section is admin-only; an overview that may be
    // public must not become the way around it.
    const { service, jobs, quotas } = build();

    const report = await service.report('src-1', {}, false);

    expect(report.health.syncedAt).toBe('2026-07-30T09:00:00.000Z');
    expect(report.health.queues).toBeNull();
    expect(report.health.quotaLeft).toBeNull();
    expect(jobs.snapshot).not.toHaveBeenCalled();
    expect(quotas.list).not.toHaveBeenCalled();
  });

  it('reports the tightest quota bucket to an account', async () => {
    // The bucket about to refuse the next call is the one worth showing;
    // averaging the buckets would hide exactly that one.
    const { service, quotas } = build();
    quotas.list.mockResolvedValue([
      { subjectKind: 'source', limit: 100, remaining: 80 },
      { subjectKind: 'source', limit: 100, remaining: 12 },
      { subjectKind: 'tracker', limit: 100, remaining: 1 },
    ]);

    const report = await service.report('src-1', {}, true);

    expect(report.health.quotaLeft).toBeCloseTo(0.12, 6);
  });
});
