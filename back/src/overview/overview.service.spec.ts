import { describe, expect, it, vi } from 'vitest';
import type { DoraResult, PipelineStatus, PullRequest } from '@repo/shared';
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

/** What the DORA service answers with — its readings, and its slices of them. */
interface DoraStub {
  results?: DoraResult[];
  trend?: DoraResult[][];
}

function build(overrides: Partial<CollectedSource> = {}, dora: DoraStub = {}) {
  const collected: CollectedSource = {
    repos: ['acme/api', 'acme/web'],
    pullRequests: [pullRequest(200), pullRequest(4)],
    pipelines: [],
    deployments: [],
    latest: [],
    environments: [],
    mode: 'stored',
    syncedAt: '2026-07-30T09:00:00.000Z',
    warnings: [],
    ...overrides,
  };
  // What runs now defaults to the window: a fixture that says nothing about
  // the difference is a fixture where the two are the same list.
  if (!overrides.latest) collected.latest = collected.deployments;

  const jobs = { snapshot: vi.fn().mockResolvedValue({ queues: [], observedAt: '', unreachable: null }) };
  const quotas = { list: vi.fn().mockResolvedValue([]) };

  const dashboard = { collect: vi.fn().mockResolvedValue(collected) };

  const service = new OverviewService(
    dashboard as never,
    {
      reportOverTime: vi.fn().mockResolvedValue({
        results: dora.results ?? [],
        repos: collected.repos,
        dimensions: {},
        // Wide enough to hold the fixtures above: the board reports over this
        // period now, so a deployment outside it is not a row.
        period: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z', windowDays: 30 },
        trend: dora.trend ?? [],
      }),
    } as never,
    jobs as never,
    quotas as never,
    { get: vi.fn().mockResolvedValue({ stalePrHours: 72 }) } as never,
  );
  return { service, jobs, quotas, dashboard };
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

  it('leaves out an environment nothing reached inside the period', async () => {
    // The board reports over the window now: a row's count and its heartbeat
    // describe it, and an environment last deployed before it has neither.
    const { service } = build({
      deployments: [
        deployment('prod-acme-api', { type: 'prod' }, { createdAt: '2026-07-20T10:00:00.000Z' }),
        deployment('prod-globex-api', { type: 'prod' }, { createdAt: '2026-06-02T10:00:00.000Z' }),
      ],
    });

    const report = await service.report('src-1', {}, true);

    expect(report.environments.map((e) => e.name)).toEqual(['prod-acme-api']);
    // The vocabulary still offers what the older one carried: a filter must
    // not lose the value you would widen back to.
    expect(report.dimensions).toEqual({ type: ['prod'] });
  });

  it('keeps what runs out of reach of the period', async () => {
    // The matrix exists to reveal a version that has *not* moved: narrowing it
    // to the period would hide precisely the rows it is looked at for.
    const stale = deployment('prod-globex-api', { type: 'prod' }, {
      createdAt: '2026-06-02T10:00:00.000Z',
      ref: 'v1.9.0',
    });
    const fresh = deployment('prod-acme-api', { type: 'prod' }, {
      createdAt: '2026-07-20T10:00:00.000Z',
    });
    const { service } = build({ deployments: [fresh], latest: [fresh, stale] });

    const report = await service.report('src-1', {}, true);

    expect(report.environments.map((e) => e.name)).toEqual(['prod-acme-api']);
    expect(report.running.map((e) => e.name)).toEqual(['prod-acme-api', 'prod-globex-api']);
    expect(report.running.find((e) => e.name === 'prod-globex-api')?.ref).toBe('v1.9.0');
  });

  it('narrows what runs by the dimensions, since those are not a period', async () => {
    const { service } = build({
      deployments: [],
      latest: [
        deployment('prod-acme-api', { type: 'prod', client: 'acme' }),
        deployment('prod-globex-api', { type: 'prod', client: 'globex' }),
      ],
    });

    const report = await service.report('src-1', { dimension: ['client:acme'] }, true);

    expect(report.running.map((e) => e.name)).toEqual(['prod-acme-api']);
  });

  it('offers a dimension only an out-of-period environment carries', async () => {
    // Narrowing the period must not quietly remove the value you would widen
    // the dimension back on.
    const { service } = build({
      deployments: [deployment('prod-acme-api', { client: 'acme' })],
      latest: [
        deployment('prod-acme-api', { client: 'acme' }),
        deployment('prod-globex-api', { client: 'globex' }),
      ],
    });

    const report = await service.report('src-1', {}, true);

    expect(report.dimensions).toEqual({ client: ['acme', 'globex'] });
  });

  it('keeps the journal on its own window whatever the period is', async () => {
    // The two read one list: the board takes the period, the journal takes the
    // recent past, and neither may cut the other short.
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    const { service } = build({
      deployments: [
        deployment('prod-acme-api', { type: 'prod' }, { createdAt: '2026-07-31T08:00:00.000Z' }),
        deployment('prod-globex-api', { type: 'prod' }, { createdAt: '2026-06-02T10:00:00.000Z' }),
      ],
    });

    const report = await service.report('src-1', {}, true);

    // Out of the period, so out of the board — but the journal is not the board.
    expect(report.environments.map((e) => e.name)).toEqual(['prod-acme-api']);
    expect(report.events.map((e) => e.at)).toEqual(['2026-07-31T08:00:00.000Z']);
    vi.useRealTimers();
  });

  it('reads back far enough for whichever window reaches furthest', async () => {
    // A one-day period must not cost the journal its second day: the read is
    // bounded by the further of the two.
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    const { service, dashboard } = build({});

    await service.report('src-1', {}, true);

    const since = new Date(dashboard.collect.mock.calls[0][3] as string).getTime();
    expect(since).toBeLessThanOrEqual(new Date('2026-07-29T12:00:00.000Z').getTime());
    vi.useRealTimers();
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

  it('keeps the last two days of deployments, most recent first', async () => {
    // Two days rather than one so a Monday morning still shows the Friday
    // evening release — the hour somebody is most likely to be looking.
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    const { service } = build({
      deployments: [
        deployment('prod-acme-api', { type: 'prod' }, { createdAt: '2026-07-28T09:00:00.000Z' }),
        deployment('prod-acme-api', { type: 'prod' }, { createdAt: '2026-07-29T06:00:00.000Z' }),
        deployment('prod-acme-api', { type: 'prod' }, { createdAt: '2026-07-30T08:00:00.000Z' }),
        deployment(
          'prod-acme-api',
          { type: 'prod' },
          { createdAt: '2026-07-30T11:00:00.000Z', status: 'failed' },
        ),
      ],
    });

    const report = await service.report('src-1', {}, true);

    // The 28th at 09:00 is 51 hours back: outside, and the only one that is.
    expect(report.events.map((e) => e.at)).toEqual([
      '2026-07-30T11:00:00.000Z',
      '2026-07-30T08:00:00.000Z',
      '2026-07-29T06:00:00.000Z',
    ]);
    expect(report.events[0].attributes).toEqual({ type: 'prod' });
    vi.useRealTimers();
  });

  it('carries what each event is, so the journal can name and open it', async () => {
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    const { service } = build({
      deployments: [
        deployment(
          'prod-acme-api',
          { type: 'prod' },
          { id: 'gh:acme/api:41', createdAt: '2026-07-30T08:00:00.000Z', url: 'https://x.test/41' },
        ),
      ],
    });

    const report = await service.report('src-1', {}, true);

    // The identity is the provider's: two deployments of one environment in
    // the same second are two lines, not one.
    expect(report.events[0]).toMatchObject({ id: 'gh:acme/api:41', url: 'https://x.test/41' });
    vi.useRealTimers();
  });

  it('draws each metric from the slices of the period it reports on', async () => {
    // Not from the historised snapshots: those hold what a metric was worth
    // over the collection's own window, so every period was shown one line.
    const count = (value: number) => ({
      metric: 'deployment_frequency' as const,
      value,
      unit: 'count' as const,
      dimensions: {},
      sampleSize: value,
      samples: [],
    });
    const { service } = build(
      {},
      { results: [count(20)], trend: [[count(3)], [], [count(9)]] },
    );

    const report = await service.report('src-1', {}, true);

    const [flow] = report.flow;
    expect(flow.value).toBe(20);
    // A slice that deployed nothing is a zero, not a hole: it is the quiet
    // week the line exists to show.
    expect(flow.trend).toEqual([3, 0, 9]);
    expect(flow.improving).toBe(true);
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
