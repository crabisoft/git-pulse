import { describe, expect, it, vi } from 'vitest';
import type { DashboardEnvironment, Deployment, PipelineStatus, PullRequest } from '@repo/shared';
import { OverviewService } from './overview.service';
import type { CollectedSource } from '../dashboard/dashboard.service';

function environment(
  name: string,
  attributes: Record<string, string>,
  metaEnvironments: string[] = [],
): DashboardEnvironment {
  return {
    name,
    attributes,
    metaEnvironments,
    repos: ['acme/api'],
    deployments: 3,
    lastDeployAt: '2026-07-30T10:00:00.000Z',
    lastStatus: 'success',
    ref: 'v2.14.1',
    recent: ['success', 'failed', 'success'],
  };
}

function deployment(environmentName: string, at: string, status: PipelineStatus = 'success'): Deployment {
  return {
    id: `${environmentName}-${at}`,
    repo: 'acme/api',
    environment: environmentName,
    ref: 'v2.14.1',
    status,
    createdAt: at,
    environmentUrl: null,
    url: null,
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
      environments: [
        environment('prod-acme-api', { type: 'prod', client: 'acme', app: 'api' }),
        environment('prod-globex-web', { type: 'prod', client: 'globex', app: 'web' }),
        environment('qa-web', { app: 'web' }),
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
      environments: [
        environment('prod-acme-api', { type: 'prod', client: 'acme' }),
        environment('qa-web', { type: 'qa' }),
      ],
    });

    const report = await service.report('src-1', { dimension: ['type:qa'] }, true);

    expect(report.environments.map((e) => e.name)).toEqual(['qa-web']);
    expect(report.environments[0].attributes.client).toBeUndefined();
  });

  it('narrows on a meta-environment as well as on an attribute', async () => {
    const { service } = build({
      environments: [
        environment('prod-acme-api', { type: 'prod' }, ['production']),
        environment('preprod-acme-api', { type: 'preprod' }, ['préproduction']),
      ],
    });

    const report = await service.report('src-1', { meta: 'production' }, true);

    expect(report.environments.map((e) => e.name)).toEqual(['prod-acme-api']);
    expect(report.metaEnvironments).toEqual(['production', 'préproduction']);
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
      environments: [environment('prod-acme-api', { type: 'prod' })],
      deployments: [
        deployment('prod-acme-api', '2026-07-28T12:00:00.000Z'),
        deployment('prod-acme-api', '2026-07-30T08:00:00.000Z'),
        deployment('prod-acme-api', '2026-07-30T11:00:00.000Z', 'failed'),
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
