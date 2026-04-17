/**
 * What the API answers while the screens are being looked at.
 *
 * Fixed rather than fetched: these suites are about layout, and a layout that
 * depends on what a live backend happens to hold is not one that can be
 * compared between two runs. Long names and long branch names are deliberate —
 * a row that fits because the data was short proves nothing about a phone.
 */

/**
 * The instant these fixtures describe. Half of what the pages show is relative
 * to now — "8m ago", a 24-hour strip, a period label — so a suite that wants
 * those to read the way they were written pins the clock here.
 */
export const NOW = '2025-07-31T10:00:00Z';

export const USER = {
  id: 'u-1',
  email: 'john.doe@example.com',
  name: 'John Doe',
  role: 'admin',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
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
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
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
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
  ],
  page: { total: 2, limit: 25, offset: 0 },
};

const DEPLOYMENT = (i: number) => ({
  id: `gh:checkout-service:${i}`,
  repo: 'acme/checkout-service',
  environment: i % 2 === 0 ? 'production' : 'staging',
  ref: `release/2025.07.${10 + i}-hotfix-payment-retry`,
  status: i % 3 === 0 ? 'failed' : 'success',
  createdAt: `2025-07-${(10 + i).toString().padStart(2, '0')}T09:24:00Z`,
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
  period: { from: '2025-07-01T00:00:00Z', to: '2025-07-31T00:00:00Z' },
};

const CHANGELOG = (i: number) => ({
  id: `cl-${i}`,
  deploymentId: `gh:checkout-service:${i}`,
  repo: 'acme/checkout-service',
  environment: i % 2 === 0 ? 'production' : 'staging',
  ref: `release/2025.07.${10 + i}-hotfix-payment-retry`,
  baseRef: `release/2025.07.${9 + i}-hotfix-payment-retry`,
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
  deployedAt: `2025-07-${(10 + i).toString().padStart(2, '0')}T09:24:00Z`,
  archivedAt: `2025-07-${(10 + i).toString().padStart(2, '0')}T10:00:00Z`,
});

/** A `ChangelogReport`: what was filed, and the vocabularies the filters offer. */
export const CHANGELOGS = {
  changelogs: {
    items: Array.from({ length: 6 }, (_, i) => CHANGELOG(i)),
    page: { total: 6, limit: 25, offset: 0, hasMore: false },
  },
  repos: ['acme/checkout-service', 'acme/identity-provider'],
  environments: ['production', 'staging'],
  lastArchivedAt: '2025-07-31T02:00:00Z',
};

/** A `JobsSnapshot`: both queues, one of them on a schedule. */
export const JOBS = {
  observedAt: '2025-07-31T10:00:00Z',
  unreachable: null,
  queues: [
    {
      name: 'collection',
      counts: { waiting: 3, active: 2, completed: 412, failed: 1, delayed: 1 },
      repeatables: [
        { name: 'collect-all', pattern: '*/15 * * * *', nextRunAt: '2025-07-31T10:15:00Z' },
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
      startedAt: '2025-07-31T09:52:00Z',
      enqueuedAt: '2025-07-31T09:51:58Z',
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
      enqueuedAt: '2025-07-31T09:58:30Z',
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
      enqueuedAt: '2025-07-31T09:59:00Z',
      scheduledFor: '2025-07-31T10:14:00Z',
      progress: null,
      attemptsMade: 1,
      data: { sourceId: 'src-1' },
    },
  ],
  page: { total: 3, limit: 20, offset: 0, hasMore: false },
};

/** An environment as the overview folds it, one row of the pivot. */
const ENVIRONMENT = (
  name: string,
  attributes: Record<string, string>,
  repos: string[],
  ref: string,
  recent: string[],
) => ({
  name,
  attributes,
  metaEnvironments: name.startsWith('prod') ? ['prod'] : [],
  repos,
  deployments: recent.length,
  lastDeployAt: '2025-07-31T09:24:00Z',
  lastStatus: recent[recent.length - 1],
  ref,
  recent,
});

const OK = ['success', 'success', 'success', 'success', 'success'];

/** An `OverviewReport`: what the dashboard reads in one call. */
/**
 * What a wide estate looks like: five applications on fifteen environments.
 *
 * Deliberately wider than any screen the harness opens. The porthole this
 * fixture exists to catch only appears once the grid is wider than the text
 * column — three environments would prove nothing, and would have passed
 * before the escape was written just as happily as after it.
 */
const VERSION_ENVIRONMENTS = [
  'canary',
  'demo',
  'dev',
  'integration',
  'load',
  'perf',
  'preprod',
  'prod-ap',
  'prod-eu',
  'prod-us',
  'qa',
  'sandbox',
  'staging',
  'training',
  'uat',
];

const VERSION_REPOS = [
  'acme/checkout-service',
  'acme/identity-provider',
  'acme/notification-worker',
  'acme/reporting-api',
  'acme/storefront',
];

export const ENVIRONMENT_VERSIONS = VERSION_REPOS.flatMap((repo, r) =>
  VERSION_ENVIRONMENTS.map((environment, e) => ({
    repo,
    environment,
    version: `${2 + (r % 3)}.${(e % 5) + 1}.${(r + e) % 9}`,
    deploymentId: `dep-${r}-${e}`,
    ref: `v${2 + (r % 3)}.${(e % 5) + 1}.${(r + e) % 9}`,
    ruleId: 'vr-1',
    url: `https://${environment}.example.test/version`,
    status: (r + e) % 11 === 0 ? 'unreachable' : 'ok',
    error: (r + e) % 11 === 0 ? { code: 'errors.version.timeout' } : null,
    attributes: { client: r % 2 === 0 ? 'northwind' : 'globex' },
    metaEnvironments: environment.startsWith('prod') ? ['prod'] : [],
    observedAt: '2025-07-31T09:40:00Z',
    changedAt: '2025-07-30T18:10:00Z',
  })),
);

export const OVERVIEW = {
  sourceId: 'src-1',
  environments: [
    ENVIRONMENT(
      'production',
      { client: 'northwind', app: 'checkout' },
      ['acme/checkout-service'],
      'release/2025.07.31',
      [...OK, 'success'],
    ),
    ENVIRONMENT(
      'staging',
      { client: 'northwind', app: 'checkout' },
      ['acme/checkout-service'],
      'main',
      [...OK, 'failed'],
    ),
    ENVIRONMENT(
      'production-eu',
      { client: 'globex', app: 'identity' },
      ['acme/identity-provider'],
      'v4.2.0',
      OK,
    ),
    ENVIRONMENT(
      'review-1284',
      { client: 'globex', app: 'identity' },
      ['acme/identity-provider'],
      'feat/passkey-enrolment',
      ['failed', 'success'],
    ),
  ],
  // What runs now, which no period narrows. The same list here: a fixture that
  // says nothing about the difference is one where the two are the same, and
  // the matrix reads this one rather than the window above it.
  running: [
    ENVIRONMENT(
      'production',
      { client: 'northwind', app: 'checkout' },
      ['acme/checkout-service'],
      'release/2025.07.31',
      [...OK, 'success'],
    ),
    ENVIRONMENT(
      'production-eu',
      { client: 'globex', app: 'identity' },
      ['acme/identity-provider'],
      'v4.2.0',
      OK,
    ),
  ],
  dimensions: { client: ['globex', 'northwind'], app: ['checkout', 'identity'] },
  metaEnvironments: ['prod'],
  repos: ['acme/checkout-service', 'acme/identity-provider'],
  flow: [
    {
      metric: 'deployment_frequency',
      value: 63,
      unit: 'count',
      sampleSize: 63,
      trend: [38, 41, 44, 43, 49, 52, 58, 61, 63],
      delta: 0.18,
      improving: true,
    },
    {
      metric: 'lead_time',
      value: 97_200,
      unit: 'seconds',
      sampleSize: 48,
      trend: [190_000, 174_000, 168_000, 150_000, 141_000, 120_000, 108_000, 99_000, 97_200],
      delta: -0.21,
      improving: true,
    },
    {
      metric: 'change_failure_rate',
      value: 0.11,
      unit: 'ratio',
      sampleSize: 63,
      trend: [0.19, 0.17, 0.18, 0.15, 0.14, 0.16, 0.12, 0.11, 0.11],
      delta: -0.08,
      improving: true,
    },
    {
      metric: 'mttr',
      value: 5_400,
      unit: 'seconds',
      sampleSize: 7,
      trend: [12_600, 11_400, 9_000, 9_600, 8_100, 7_200, 6_300, 5_400, 5_400],
      delta: 0.04,
      improving: false,
    },
  ],
  friction: {
    openPrs: 14,
    stalePrs: 3,
    failedPipelines: 2,
    runningPipelines: 1,
    reviewTimeSec: 43_200,
  },
  health: {
    mode: 'stored',
    syncedAt: '2025-07-31T09:52:00Z',
    staleForSec: 480,
    queues: 'ok',
    quotaLeft: 0.68,
  },
  events: Array.from({ length: 9 }, (_, i) => ({
    at: `2025-07-31T${(2 + i * 2).toString().padStart(2, '0')}:12:00Z`,
    environment: i % 3 === 0 ? 'production' : i % 3 === 1 ? 'staging' : 'production-eu',
    repo: i % 2 === 0 ? 'acme/checkout-service' : 'acme/identity-provider',
    ref: i % 2 === 0 ? 'release/2025.07.31' : 'v4.2.0',
    status: i === 4 ? 'failed' : 'success',
    attributes:
      i % 2 === 0
        ? { client: 'northwind', app: 'checkout' }
        : { client: 'globex', app: 'identity' },
  })),
  period: { from: '2025-07-01T00:00:00Z', to: '2025-07-31T00:00:00Z', windowDays: 30 },
  warnings: [],
  versions: ENVIRONMENT_VERSIONS,
};

const SAMPLE = (i: number, label: string, value: number | null) => ({
  label,
  at: `2025-07-${(31 - i).toString().padStart(2, '0')}T14:05:00Z`,
  value,
  status: i === 3 ? 'failed' : 'success',
  url: 'https://github.com/acme/checkout-service/pull/1284',
  details: { repo: 'acme/checkout-service' },
});

const RESULT = (
  metric: string,
  value: number,
  unit: string,
  sampleSize: number,
  label: string,
) => ({
  metric,
  value,
  unit,
  dimensions: {},
  sampleSize,
  samples: Array.from({ length: 5 }, (_, i) => SAMPLE(i, label, unit === 'count' ? null : value)),
  combinations: 4,
});

/** A `DoraReport`: one reading per metric, plus the filter vocabularies. */
export const DORA = {
  results: [
    RESULT('deployment_frequency', 63, 'count', 63, 'production'),
    RESULT('lead_time', 97_200, 'seconds', 48, 'acme/checkout-service#1284'),
    RESULT('change_failure_rate', 0.11, 'ratio', 63, 'production'),
    RESULT('mttr', 5_400, 'seconds', 7, 'production'),
    RESULT('coding_time', 28_800, 'seconds', 48, 'acme/checkout-service#1284'),
    RESULT('pickup_time', 19_800, 'seconds', 48, 'acme/checkout-service#1284'),
    RESULT('review_time', 43_200, 'seconds', 48, 'acme/checkout-service#1284'),
    RESULT('deploy_time', 5_400, 'seconds', 48, 'production'),
  ],
  repos: ['acme/checkout-service', 'acme/identity-provider'],
  dimensions: { client: ['globex', 'northwind'], app: ['checkout', 'identity'] },
  period: { from: '2025-07-01T00:00:00Z', to: '2025-07-31T00:00:00Z', windowDays: 30 },
};

/** A page of `DoraSample`, as the metric sub-page lists them. */
export const DORA_SAMPLES = {
  items: Array.from({ length: 8 }, (_, i) =>
    SAMPLE(i, `acme/checkout-service#${1284 - i}`, 97_200 - i * 4_200),
  ),
  page: { total: 48, limit: 25, offset: 0, hasMore: true },
};

/**
 * The raw snapshots the DORA page folds into its sparklines — one series per
 * metric, oldest first, ending on the value the report states.
 */
const HISTORY: Record<string, number[]> = {
  deployment_frequency: [38, 41, 44, 43, 49, 52, 55, 58, 61, 60, 63],
  lead_time: [190_000, 174_000, 168_000, 159_000, 150_000, 141_000, 133_000, 120_000, 111_000, 104_000, 97_200],
  change_failure_rate: [0.19, 0.17, 0.18, 0.15, 0.14, 0.16, 0.13, 0.12, 0.12, 0.11, 0.11],
  mttr: [12_600, 11_400, 9_000, 9_600, 8_100, 7_800, 7_200, 6_300, 6_000, 5_400, 5_400],
  coding_time: [41_000, 39_600, 37_800, 36_000, 34_200, 33_000, 31_500, 30_600, 29_400, 28_800, 28_800],
  pickup_time: [30_600, 28_800, 27_000, 25_200, 24_000, 23_400, 22_200, 21_600, 20_400, 19_800, 19_800],
  review_time: [61_200, 59_400, 57_600, 54_000, 52_200, 50_400, 48_600, 46_800, 45_000, 43_800, 43_200],
  deploy_time: [10_800, 10_200, 9_000, 8_400, 7_800, 7_200, 6_600, 6_000, 5_400, 5_400, 5_400],
};

/** A page of `MetricSnapshotPublic`, ascending — what the sparklines are folded from. */
export const METRIC_SNAPSHOTS = {
  items: Object.entries(HISTORY).flatMap(([metric, values]) =>
    values.map((value, i) => ({
      id: `snap-${metric}-${i}`,
      sourceId: 'src-1',
      metric,
      value,
      dimensions: {},
      capturedAt: `2025-07-${(21 + i).toString().padStart(2, '0')}T02:00:00Z`,
    })),
  ),
  page: { total: 88, limit: 200, offset: 0, hasMore: false },
};

/** A `MetricSeries`: the trend a metric sub-page plots. */
export const METRIC_SERIES = {
  metric: 'lead_time',
  dimensions: {},
  bucket: 'day',
  points: [
    190_000, 186_000, 174_000, 171_000, 168_000, 159_000, 150_000, 148_000, 141_000, 133_000,
    120_000, 118_000, 111_000, 108_000, 104_000, 99_000, 97_200,
  ].map((value, i) => ({
    at: `2025-07-${(15 + i).toString().padStart(2, '0')}T00:00:00Z`,
    value,
  })),
  snapshotCount: 412,
};

/**
 * Every route the screens touch, most specific first — the collections hang off
 * `/sources/:id/…`, so a pattern for `sources` would swallow them if it came
 * before theirs.
 */
export const ROUTES: Array<[RegExp, unknown]> = [
  [/\/api\/auth\/me$/, AUTH],
  [/\/api\/settings(\?|$)/, SETTINGS],
  [/\/api\/overview\//, OVERVIEW],
  [/\/api\/sources\/[^/]+\/deployments/, DEPLOYMENTS],
  [/\/api\/sources\/[^/]+\/changelogs/, CHANGELOGS],
  [/\/api\/sources\/[^/]+\/dora\/samples/, DORA_SAMPLES],
  [/\/api\/sources\/[^/]+\/dora/, DORA],
  [/\/api\/sources\/[^/]+\/metrics\/series/, METRIC_SERIES],
  [/\/api\/sources\/[^/]+\/metrics/, METRIC_SNAPSHOTS],
  [/\/api\/sources(\/[^/]+)?(\?|$)/, SOURCES],
  // Answers as a list, like the two below it. Left unmatched it fell through
  // to the page envelope, and the sources page crashed iterating an object —
  // which is how a fixture gap reads on screen.
  [/\/api\/coverage/, []],
  [/\/api\/quotas/, []],
  [/\/api\/budgets/, []],
  [/\/api\/env-rules/, EMPTY_PAGE],
  [/\/api\/trackers/, EMPTY_PAGE],
  [/\/api\/jobs\/running/, RUNNING],
  [/\/api\/jobs\/(failures|degraded)/, EMPTY_PAGE],
  [/\/api\/jobs/, JOBS],
  [/\/api\/users/, { items: [USER], page: { total: 1, limit: 25, offset: 0 } }],
];
