/**
 * What the API answers while the screens are being looked at.
 *
 * Fixed rather than fetched: these suites are about layout, and a layout that
 * depends on what a live backend happens to hold is not one that can be
 * compared between two runs. Long names and long branch names are deliberate —
 * a row that fits because the data was short proves nothing about a phone.
 */

export const USER = {
  id: 'u-1',
  email: 'jacqueline.raphanel@example.com',
  name: 'Jacqueline Raphanel',
  role: 'admin',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  display: { direction: null, mode: null },
  language: null,
};

export const AUTH = { user: USER, publicDashboard: true, setupRequired: false };

export const SETTINGS = {
  doraWindowDays: 30,
  stalePrHours: 72,
  collectCron: '*/15 * * * *',
  pruneCron: '0 3 * * *',
  retentionMarginDays: 7,
  pageSize: 25,
  publicDashboard: true,
  failureSource: 'both',
  incidentLabels: ['incident', 'production-outage'],
  quotaReservePct: 10,
  releaseNotesGenerator: 'builtin',
  overviewDirection: 'control',
  displayMode: 'system',
};

export const SOURCES = {
  items: [
    {
      id: 'src-1',
      name: 'Acme Platform',
      slug: 'acme-platform',
      kind: 'github',
      baseUrl: 'https://github.com',
      authKind: 'token',
      scope: { owner: 'acme', include: [], exclude: [], trackNewRepos: true },
      mode: 'stored',
      webhooksEnabled: true,
      historyDays: 90,
      isDefault: true,
      envRuleIds: [],
      trackerIds: [],
      incidentTrackerId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'src-2',
      name: 'Widget Factory (self-hosted GitLab)',
      slug: 'widget-factory',
      kind: 'gitlab',
      baseUrl: 'https://gitlab.internal.example.com',
      authKind: 'token',
      scope: { owner: 'widgets', include: [], exclude: [], trackNewRepos: false },
      mode: 'live',
      webhooksEnabled: false,
      historyDays: null,
      isDefault: false,
      envRuleIds: [],
      trackerIds: [],
      incidentTrackerId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  page: { total: 2, limit: 25, offset: 0 },
};

const DEPLOYMENT = (i: number) => ({
  id: `gh:checkout-service:${i}`,
  repo: 'acme/checkout-service',
  environment: i % 2 === 0 ? 'production' : 'staging',
  ref: `release/2026.07.${10 + i}-hotfix-payment-retry`,
  status: i % 3 === 0 ? 'failed' : 'success',
  createdAt: `2026-07-${(10 + i).toString().padStart(2, '0')}T09:24:00Z`,
  environmentUrl: 'https://checkout.acme.example.com',
  url: 'https://github.com/acme/checkout-service/deployments/1',
  refUrl: 'https://github.com/acme/checkout-service/tree/release',
  attributes: i % 2 === 0 ? { client: 'northwind', app: 'checkout' } : {},
  metaEnvironments: i % 2 === 0 ? ['prod'] : [],
});

export const EMPTY_PAGE = {
  items: [],
  page: { total: 0, limit: 25, offset: 0, hasMore: false },
};

/** A `DeploymentReport`: the page of rows plus the vocabularies the filters offer. */
export const DEPLOYMENTS = {
  deployments: {
    items: Array.from({ length: 8 }, (_, i) => DEPLOYMENT(i)),
    page: { total: 8, limit: 25, offset: 0, hasMore: false },
  },
  repos: ['acme/checkout-service', 'acme/identity-provider'],
  environments: ['production', 'staging'],
  statuses: ['success', 'failed'],
  dimensions: { client: ['northwind'], app: ['checkout'] },
  period: { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z' },
};

const CHANGELOG = (i: number) => ({
  id: `cl-${i}`,
  deploymentId: `gh:checkout-service:${i}`,
  repo: 'acme/checkout-service',
  environment: i % 2 === 0 ? 'production' : 'staging',
  ref: `release/2026.07.${10 + i}-hotfix-payment-retry`,
  baseRef: `release/2026.07.${9 + i}-hotfix-payment-retry`,
  base: 'previous',
  refUrl: 'https://github.com/acme/checkout-service/tree/release',
  baseRefUrl: 'https://github.com/acme/checkout-service/tree/release',
  deploymentUrl: 'https://github.com/acme/checkout-service/deployments/1',
  environmentUrl: 'https://checkout.acme.example.com',
  status: i % 3 === 0 ? 'failed' : 'success',
  authors: 3,
  commits: 12,
  // One filed without contents: the row it draws is a shape of its own.
  unreadable: i === 2,
  generator: 'builtin',
  deployedAt: `2026-07-${(10 + i).toString().padStart(2, '0')}T09:24:00Z`,
  archivedAt: `2026-07-${(10 + i).toString().padStart(2, '0')}T10:00:00Z`,
});

/** A `ChangelogReport`: what was filed, and the vocabularies the filters offer. */
export const CHANGELOGS = {
  changelogs: {
    items: Array.from({ length: 6 }, (_, i) => CHANGELOG(i)),
    page: { total: 6, limit: 25, offset: 0, hasMore: false },
  },
  repos: ['acme/checkout-service', 'acme/identity-provider'],
  environments: ['production', 'staging'],
  lastArchivedAt: '2026-07-31T02:00:00Z',
};

/** A `JobsSnapshot`: both queues, one of them on a schedule. */
export const JOBS = {
  observedAt: '2026-07-31T10:00:00Z',
  unreachable: null,
  queues: [
    {
      name: 'collection',
      counts: { waiting: 3, active: 2, completed: 412, failed: 1, delayed: 1 },
      repeatables: [
        { name: 'collect-all', pattern: '*/15 * * * *', nextRunAt: '2026-07-31T10:15:00Z' },
      ],
      paused: false,
    },
    {
      name: 'ingest',
      counts: { waiting: 0, active: 0, completed: 88, failed: 0, delayed: 0 },
      repeatables: [],
      paused: false,
    },
  ],
};

/**
 * A page of `JobRunning`, with the three states and a payload worth folding
 * away. Wide on purpose: this is the widest table the settings hold, and a
 * phone is where it either fits or does not.
 */
export const RUNNING = {
  items: [
    {
      queue: 'collection',
      id: '1041',
      name: 'collect-source',
      state: 'active',
      startedAt: '2026-07-31T09:52:00Z',
      enqueuedAt: '2026-07-31T09:51:58Z',
      scheduledFor: null,
      progress: null,
      attemptsMade: 2,
      data: { sourceId: 'src-1', force: true },
    },
    {
      queue: 'ingest',
      id: '1042',
      name: 'ingest-event',
      state: 'waiting',
      startedAt: null,
      enqueuedAt: '2026-07-31T09:58:30Z',
      scheduledFor: null,
      progress: null,
      attemptsMade: 1,
      data: { sourceId: 'src-1', intent: { kind: 'deployment', repo: 'acme/checkout-service' } },
    },
    {
      queue: 'collection',
      id: '1043',
      name: 'collect-source',
      state: 'delayed',
      startedAt: null,
      enqueuedAt: '2026-07-31T09:59:00Z',
      scheduledFor: '2026-07-31T10:14:00Z',
      progress: null,
      attemptsMade: 1,
      data: { sourceId: 'src-1' },
    },
  ],
  page: { total: 3, limit: 20, offset: 0, hasMore: false },
};

/**
 * Every route the screens touch, most specific first — the collections hang off
 * `/sources/:id/…`, so a pattern for `sources` would swallow them if it came
 * before theirs.
 */
export const ROUTES: Array<[RegExp, unknown]> = [
  [/\/api\/auth\/me$/, AUTH],
  [/\/api\/settings(\?|$)/, SETTINGS],
  [/\/api\/sources\/[^/]+\/deployments/, DEPLOYMENTS],
  [/\/api\/sources\/[^/]+\/changelogs/, CHANGELOGS],
  [/\/api\/sources\/[^/]+\/(metrics|dora)/, EMPTY_PAGE],
  [/\/api\/sources(\/[^/]+)?(\?|$)/, SOURCES],
  [/\/api\/quotas/, []],
  [/\/api\/budgets/, []],
  [/\/api\/env-rules/, EMPTY_PAGE],
  [/\/api\/trackers/, EMPTY_PAGE],
  [/\/api\/jobs\/running/, RUNNING],
  [/\/api\/jobs\/(failures|degraded)/, EMPTY_PAGE],
  [/\/api\/jobs/, JOBS],
  [/\/api\/users/, { items: [USER], page: { total: 1, limit: 25, offset: 0 } }],
];
