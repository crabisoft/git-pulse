/**
 * What the API answers while the screens are being looked at.
 *
 * Fixed rather than fetched: these suites are about layout, and a layout that
 * depends on what a live backend happens to hold is not one that can be
 * compared between two runs. Long names and long branch names are deliberate —
 * a row that fits because the data was short proves nothing about a phone.
 *
 * Every fixture is annotated with the type its endpoint answers, and `e2e` is
 * in the `tsconfig`, so a field the API grew is a compile error here rather
 * than a blank screenshot. It was the latter twice: a `DoraReport` that
 * predated `truncated`, and incidents answered as a page where the view reads
 * an array — a view that throws renders as an empty picture, not as an error,
 * and both went out in the guide.
 */
import type {
  AppSettings,
  AuthState,
  Branch,
  ChangelogReport,
  ClassifiedDeployment,
  ClassifiedEnvironment,
  DashboardEnvironment,
  DeploymentChangelogSummary,
  DeploymentReport,
  DoraMetric,
  DoraReport,
  DoraResult,
  DoraSample,
  EnvRulePublic,
  EnvironmentVersion,
  Incident,
  JobRunning,
  JobsSnapshot,
  LlmProviderPublic,
  MetricSeries,
  MetricSnapshotPublic,
  OverviewEvent,
  OverviewReport,
  Page,
  PipelineStatus,
  ReleaseNoteEntry,
  ReleaseNotes,
  RuleTarget,
  SourcePublic,
  Tag,
  UserPublic,
} from '@repo/shared';

/**
 * The instant these fixtures describe. Half of what the pages show is relative
 * to now — "8m ago", a 24-hour strip, a period label — so a suite that wants
 * those to read the way they were written pins the clock here.
 */
export const NOW = '2025-07-31T10:00:00Z';

export const USER: UserPublic = {
  id: 'u-1',
  email: 'john.doe@example.com',
  name: 'John Doe',
  role: 'admin',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  display: { direction: null, mode: null },
  language: null,
};

export const AUTH: AuthState = { user: USER, publicDashboard: true, setupRequired: false };

export const SETTINGS: AppSettings = {
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
  // Both arrived with the monorepo work: which dimension names a deployable,
  // and how deep a listing may be read before it gives up.
  componentAttribute: null,
  collectionPageCap: 20,
  overviewDirection: 'control',
  displayMode: 'system',
};

export const SOURCES: Page<SourcePublic> = {
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
      versionRuleIds: [],
      envUrlRuleIds: [],
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
      versionRuleIds: [],
      envUrlRuleIds: [],
      trackerIds: [],
      incidentTrackerId: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
  ],
  page: { total: 2, limit: 25, offset: 0, hasMore: false },
};

const DEPLOYMENT = (i: number): ClassifiedDeployment => ({
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

export const EMPTY_PAGE: Page<never> = {
  items: [],
  page: { total: 0, limit: 25, offset: 0, hasMore: false },
};

/** A `DeploymentReport`: the page of rows plus the vocabularies the filters offer. */
export const DEPLOYMENTS: DeploymentReport = {
  deployments: {
    items: Array.from({ length: 8 }, (_, i) => DEPLOYMENT(i)),
    page: { total: 8, limit: 25, offset: 0, hasMore: false },
  },
  repos: ['acme/checkout-service', 'acme/identity-provider'],
  environments: ['production', 'staging'],
  statuses: ['success', 'failed'],
  dimensions: { client: ['northwind'], app: ['checkout'] },
  // No version reading on this report. The readings the guide shows belong to
  // the overview's matrix, over environments this page's rows never name — a
  // source with no version rule is the state this one describes.
  versions: [],
  currentVersions: [],
  versionRules: 0,
  period: { from: '2025-07-01T00:00:00Z', to: '2025-07-31T00:00:00Z', windowDays: 30 },
};

const CHANGELOG = (i: number): DeploymentChangelogSummary => ({
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
export const CHANGELOGS: ChangelogReport = {
  changelogs: {
    items: Array.from({ length: 6 }, (_, i) => CHANGELOG(i)),
    page: { total: 6, limit: 25, offset: 0, hasMore: false },
  },
  repos: ['acme/checkout-service', 'acme/identity-provider'],
  environments: ['production', 'staging'],
  lastArchivedAt: '2025-07-31T02:00:00Z',
};

/** A `JobsSnapshot`: both queues, one of them on a schedule. */
export const JOBS: JobsSnapshot = {
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
export const RUNNING: Page<JobRunning> = {
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
  recent: PipelineStatus[],
): DashboardEnvironment => ({
  name,
  attributes,
  metaEnvironments: name.startsWith('prod') ? ['prod'] : [],
  // Every row here exists because something deployed to it; a declared one is
  // the other half of the type, and the board draws it differently.
  declared: false,
  repos,
  deployments: recent.length,
  lastDeployAt: '2025-07-31T09:24:00Z',
  lastStatus: recent[recent.length - 1],
  ref,
  recent,
});

const OK: PipelineStatus[] = ['success', 'success', 'success', 'success', 'success'];

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

/** What each repository is currently on, and versions itself independently. */
const CURRENT_RELEASE: Record<string, string> = {
  'acme/checkout-service': '2.5.0',
  'acme/identity-provider': '3.4.0',
  'acme/notification-worker': '4.3.0',
  'acme/reporting-api': '2.8.0',
  'acme/storefront': '3.6.0',
};

/** The few environments that are not on it, and how they are not. */
const MINORS_BEHIND: Record<string, number> = { canary: 1, dev: 2 };
/** Given a newer release that never came up: it still answers the current one. */
const DRIFTED = 'preprod';
/** Stopped answering. A reading that failed states no release at all. */
const SILENT = 'sandbox';

/**
 * One reading per (repo, environment), most of them agreeing.
 *
 * The releases used to be derived from the two indices, which spread them
 * evenly and left fourteen environments in fifteen behind the last one. That is
 * arithmetic rather than an estate anybody runs, and it made `behind` — the
 * exception the grid exists to surface — the background of every screenshot.
 * Three environments are singled out instead, one per thing the grid can say.
 */
export const ENVIRONMENT_VERSIONS: EnvironmentVersion[] = VERSION_REPOS.flatMap((repo, r) =>
  VERSION_ENVIRONMENTS.map((environment, e) => {
    const [major, minor] = CURRENT_RELEASE[repo].split('.').map(Number);
    const lag = MINORS_BEHIND[environment] ?? 0;
    const version = `${major}.${minor - lag}.0`;
    const silent = environment === SILENT;
    return {
      repo,
      environment,
      version: silent ? null : version,
      deploymentId: `dep-${r}-${e}`,
      // The drifted one was deployed the next release and never took it, which
      // is the whole reason the version is read back rather than assumed.
      ref: environment === DRIFTED ? `v${major}.${minor + 1}.0` : `v${version}`,
      ruleId: 'vr-1',
      url: `https://${environment}.example.test/version`,
      status: silent ? 'unreachable' : 'ok',
      error: silent ? { code: 'errors.version.timeout' } : null,
      attributes: { client: r % 2 === 0 ? 'northwind' : 'globex' },
      metaEnvironments: environment.startsWith('prod') ? ['prod'] : [],
      observedAt: '2025-07-31T09:40:00Z',
      changedAt: '2025-07-30T18:10:00Z',
    };
  }),
);

export const OVERVIEW: OverviewReport = {
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
      value: 2.1,
      unit: 'per_day',
      sampleSize: 63,
      trend: [1.27, 1.37, 1.47, 1.43, 1.63, 1.73, 1.93, 2.03, 2.1],
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
  events: Array.from({ length: 9 }, (_, i): OverviewEvent => ({
    id: `gh:deploy:${1400 + i}`,
    at: `2025-07-31T${(2 + i * 2).toString().padStart(2, '0')}:12:00Z`,
    environment: i % 3 === 0 ? 'production' : i % 3 === 1 ? 'staging' : 'production-eu',
    repo: i % 2 === 0 ? 'acme/checkout-service' : 'acme/identity-provider',
    ref: i % 2 === 0 ? 'release/2025.07.31' : 'v4.2.0',
    status: i === 4 ? 'failed' : 'success',
    url: 'https://github.com/acme/checkout-service/deployments/1',
    attributes:
      i % 2 === 0
        ? { client: 'northwind', app: 'checkout' }
        : { client: 'globex', app: 'identity' },
  })),
  period: { from: '2025-07-01T00:00:00Z', to: '2025-07-31T00:00:00Z', windowDays: 30 },
  warnings: [],
  versions: ENVIRONMENT_VERSIONS,
};

const SAMPLE = (i: number, label: string, value: number | null): DoraSample => ({
  label,
  at: `2025-07-${(31 - i).toString().padStart(2, '0')}T14:05:00Z`,
  value,
  status: i === 3 ? 'failed' : 'success',
  url: 'https://github.com/acme/checkout-service/pull/1284',
  details: { repo: 'acme/checkout-service' },
});

const RESULT = (
  metric: DoraMetric,
  value: number,
  unit: DoraResult['unit'],
  sampleSize: number,
  label: string,
): DoraResult => ({
  metric,
  value,
  unit,
  dimensions: {},
  sampleSize,
  samples: Array.from({ length: 5 }, (_, i) => SAMPLE(i, label, unit === 'per_day' ? null : value)),
  combinations: 4,
});

/** A `DoraReport`: one reading per metric, plus the filter vocabularies. */
export const DORA: DoraReport = {
  results: [
    RESULT('deployment_frequency', 2.1, 'per_day', 63, 'production'),
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
  // The ordinary answer, and not optional: the page reads its length before it
  // draws anything, so a report without it renders nothing at all.
  truncated: [],
};

/**
 * The same report over a scope the platform could not read to the end — one
 * monorepo whose merges outran the page cap.
 *
 * A variant rather than a state to reach through the interface: nothing on
 * screen produces it, it comes from what the read ran into.
 */
export const DORA_TRUNCATED: DoraReport = {
  ...DORA,
  truncated: [{ repo: 'acme/platform', resource: 'merged_pull_requests' }],
};

/** A page of `DoraSample`, as the metric sub-page lists them. */
export const DORA_SAMPLES: Page<DoraSample> = {
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
export const METRIC_SNAPSHOTS: Page<MetricSnapshotPublic> = {
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

/**
 * Lead time day by day, denser than the sparkline's eleven points: the metric
 * page draws a chart with an axis where the grid draws a thumbnail.
 */
const LEAD_TIME_TREND = [
  190_000, 186_000, 174_000, 171_000, 168_000, 159_000, 150_000, 148_000, 141_000, 133_000, 120_000,
  118_000, 111_000, 108_000, 104_000, 99_000, 97_200,
];

/** A `MetricSeries`: one metric's trend, oldest first, ending the day of `NOW`. */
const SERIES = (metric: string): MetricSeries => {
  const values = metric === 'lead_time' ? LEAD_TIME_TREND : (HISTORY[metric] ?? []);
  return {
    metric,
    dimensions: {},
    bucket: 'day',
    points: values.map((value, i) => ({
      // Counted back from the last day rather than forward from a fixed one,
      // so a series of any length ends where the report's period does.
      at: `2025-07-${(31 - (values.length - 1 - i)).toString().padStart(2, '0')}T00:00:00Z`,
      value,
    })),
    snapshotCount: values.length * 24,
  };
};

/**
 * What the series endpoint answers: one series per metric asked for, in the
 * order asked.
 *
 * Read off the query rather than fixed, because that order is the whole of
 * what the callers rely on — the DORA grid keys its sparklines by metric name,
 * and a metric page plots the first series back. A constant answered every
 * metric page with whichever metric happened to be first in it.
 */
export const METRIC_SERIES = (url: string): MetricSeries[] =>
  new URL(url).searchParams.getAll('metric').map(SERIES);

/**
 * Incidents over the journal's window, which is the delivery stream's whole
 * point: they are what a rail of deployments alone cannot show.
 *
 * Answered as a bare array, unlike almost everything else here. Left to fall
 * through to the page envelope the view threw on it, and a thrown view renders
 * as a blank screenshot rather than as an error — which is how it went
 * unnoticed.
 */
export const INCIDENTS: Incident[] = [
  {
    id: 'gh:checkout-service:412',
    key: '#412',
    title: 'Card authorisations failing at the acquirer',
    url: 'https://github.com/acme/checkout-service/issues/412',
    openedAt: '2025-07-30T21:12:00Z',
    resolvedAt: '2025-07-30T22:47:00Z',
    labels: ['incident', 'production-outage'],
    repo: 'acme/checkout-service',
    tickets: [],
  },
  {
    id: 'gh:identity-provider:118',
    key: '#118',
    title: 'Token refresh rejected for a subset of tenants',
    url: 'https://github.com/acme/identity-provider/issues/118',
    openedAt: '2025-07-31T08:05:00Z',
    resolvedAt: null,
    labels: ['incident'],
    repo: 'acme/identity-provider',
    tickets: [],
  },
];

/** A rule of the catalogue, in the shape the list draws and the form reopens. */
const ENV_RULE = (
  id: string,
  name: string,
  pattern: string,
  target: RuleTarget,
  priority: number,
  attributes: Record<string, string> = {},
  repo: string | null = null,
  kind: 'simple' | 'meta' = 'simple',
): EnvRulePublic => ({
  id,
  name,
  pattern,
  kind,
  target,
  priority,
  attributes,
  repo,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
});

/**
 * The catalogue, per target — a rule set that reads like one somebody wrote
 * rather than one invented for a picture: a convention captured, a meta
 * environment declared over it, and attributes forced onto the names that carry
 * nothing to capture. What `CLASSIFIED` answers is what these three would.
 */
export const ENVIRONMENT_RULES: Page<EnvRulePublic> = {
  items: [
    ENV_RULE(
      'er-1',
      'Client, application and type',
      '^(?<client>[a-z]+)-(?<app>[a-z]+)-(?<type>prod|staging|dev)$',
      'environment',
      10,
    ),
    // A meta rule contributes its name and nothing else, which is why this one
    // is named as the meta environment rather than after what it matches.
    ENV_RULE('er-2', 'production', '-prod$', 'environment', 20, {}, null, 'meta'),
    ENV_RULE('er-3', 'Legacy Contoso estate', '^ProdContoso', 'environment', 30, {
      client: 'contoso',
      app: 'billing',
      type: 'prod',
    }),
  ],
  page: { total: 3, limit: 25, offset: 0, hasMore: false },
};

/** The monorepo rule the guide spells out, saved: a component read off a title. */
export const PR_TITLE_RULES: Page<EnvRulePublic> = {
  items: [
    ENV_RULE(
      'er-4',
      'Component from a Conventional Commits scope',
      '^\\w+\\((?<component>[^)]+)\\)',
      'pull_request_title',
      10,
      {},
      '^acme/platform$',
    ),
  ],
  page: { total: 1, limit: 25, offset: 0, hasMore: false },
};

/** What the rule set makes of a name the preview is given. */
export const CLASSIFIED: ClassifiedEnvironment = {
  name: 'acme-billing-prod',
  attributes: { client: 'acme', app: 'billing', type: 'prod' },
  metaEnvironments: ['production'],
};

/** A provider on file, so the release notes page offers the rewriting. */
export const LLM_PROVIDERS: Page<LlmProviderPublic> = {
  items: [
    {
      id: 'llm-1',
      name: 'Anthropic',
      kind: 'anthropic',
      model: 'claude-sonnet-4-5',
      baseUrl: null,
      isDefault: true,
      hasKey: true,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
  ],
  page: { total: 1, limit: 100, offset: 0, hasMore: false },
};

/** The repos of a source, as the release notes page asks for them. */
export const REPOS: string[] = ['acme/checkout-service', 'acme/identity-provider'];

/** Tags of one repo, newest first — what the two bounds are picked from. */
export const TAGS: Tag[] = [
  { name: 'v2025.07.3', sha: '9f2c1ab4e77d3a2b5c8e10f4d6a9b3c7e2f18d40', taggedAt: '2025-07-28T08:00:00Z' },
  { name: 'v2025.07.2', sha: '3d81f0c9a4b2e675d1c8039fae5b27c4d90e6a13', taggedAt: '2025-07-14T08:00:00Z' },
  { name: 'v2025.07.1', sha: 'c7a5e93012b8d4f6a1e70c35b982d4f61a0c8e27', taggedAt: '2025-07-02T08:00:00Z' },
];

export const BRANCHES: Branch[] = [
  { name: 'main', sha: '9f2c1ab4e77d3a2b5c8e10f4d6a9b3c7e2f18d40', isDefault: true },
  { name: 'release/2025.08', sha: '5e1b7c02d9a3f486b0c25e7d1a94f3608b2c5d19', isDefault: false },
];

/** One line of a note, cited the way the page cites it. */
const ENTRY = (
  sha: string,
  summary: string,
  scope: string | null,
  message: string,
  pr: number,
  ticket: string | null,
  breaking = false,
): ReleaseNoteEntry => ({
  summary,
  message,
  scope,
  breaking,
  sha,
  author: 'Dana Whitfield',
  url: `https://github.com/acme/checkout-service/commit/${sha}`,
  tickets: ticket
    ? [
        {
          key: ticket,
          url: `https://acme.atlassian.net/browse/${ticket}`,
          foundIn: 'branch',
          tracker: { id: 'tr-1', name: 'Jira', kind: 'jira' },
        },
      ]
    : [],
  pullRequest: { number: pr, url: `https://github.com/acme/checkout-service/pull/${pr}` },
});

const BREAKING_ENTRY = ENTRY(
  '4c9e21b7a83d5f60c1e94b27a0d63f815c47e29b',
  'the payment webhook now signs its callbacks',
  'payments',
  'feat(payments)!: the payment webhook now signs its callbacks\n\nBREAKING CHANGE: consumers that did not verify a signature now receive\none, and a callback carrying none is rejected.',
  1284,
  'PAY-841',
  true,
);

/**
 * A range as the generator reads it: the breaking change lifted out, the
 * conventional types filed under their sections, and the commits that followed
 * no convention kept rather than dropped.
 */
export const RELEASE_NOTES: ReleaseNotes = {
  repo: 'acme/checkout-service',
  from: 'v2025.07.2',
  to: 'v2025.07.3',
  fromUrl: 'https://github.com/acme/checkout-service/releases/tag/v2025.07.2',
  toUrl: 'https://github.com/acme/checkout-service/releases/tag/v2025.07.3',
  breaking: [BREAKING_ENTRY],
  sections: [
    {
      type: 'feat',
      entries: [
        BREAKING_ENTRY,
        ENTRY(
          'a10f7d3e5c92b48016fa7c2d9e35b108d4f62a7c',
          'retry a declined authorisation once, on the same card',
          'payments',
          'feat(payments): retry a declined authorisation once, on the same card',
          1281,
          'PAY-836',
        ),
        ENTRY(
          '7b3c8e15d049a6f2c83b10e7d5946a2f0c8b1e34',
          'show the acquirer response code on a failed capture',
          'checkout',
          'feat(checkout): show the acquirer response code on a failed capture',
          1279,
          null,
        ),
      ],
    },
    {
      type: 'fix',
      entries: [
        ENTRY(
          'e64a09c7b1d832f5a09e7c41b6d038a2e5c19b74',
          'stop rounding the fee twice on a partial refund',
          'refunds',
          'fix(refunds): stop rounding the fee twice on a partial refund',
          1276,
          'PAY-829',
        ),
        ENTRY(
          '2f8d51a09c6e37b4d0a85f13c9e02b6d4a71f8c5',
          'release the idempotency key when the gateway times out',
          'payments',
          'fix(payments): release the idempotency key when the gateway times out\n\nThe key was held for the full ten-minute window, so a retry after a\ntimeout answered from the cache instead of reaching the gateway.',
          1274,
          'PAY-830',
        ),
      ],
    },
    {
      type: 'other',
      entries: [
        ENTRY(
          '8c4b06e2f9a137d5b8e04c1a6f92d370b5e8a24f',
          'bump the acquirer SDK to 4.2.1',
          null,
          'bump the acquirer SDK to 4.2.1',
          1272,
          null,
        ),
      ],
    },
  ],
  generator: 'builtin',
  markdown: [
    '## Breaking changes',
    '',
    '- **payments**: the payment webhook now signs its callbacks ([PAY-841](https://acme.atlassian.net/browse/PAY-841), [#1284](https://github.com/acme/checkout-service/pull/1284))',
    '',
    '## Features',
    '',
    '- **payments**: retry a declined authorisation once, on the same card ([PAY-836](https://acme.atlassian.net/browse/PAY-836), [#1281](https://github.com/acme/checkout-service/pull/1281))',
    '- **checkout**: show the acquirer response code on a failed capture ([#1279](https://github.com/acme/checkout-service/pull/1279))',
    '',
    '## Bug fixes',
    '',
    '- **refunds**: stop rounding the fee twice on a partial refund ([PAY-829](https://acme.atlassian.net/browse/PAY-829), [#1276](https://github.com/acme/checkout-service/pull/1276))',
    '- **payments**: release the idempotency key when the gateway times out ([PAY-830](https://acme.atlassian.net/browse/PAY-830), [#1274](https://github.com/acme/checkout-service/pull/1274))',
    '',
    '## Following no convention',
    '',
    '- bump the acquirer SDK to 4.2.1 ([#1272](https://github.com/acme/checkout-service/pull/1272))',
  ].join('\n'),
};

/**
 * What a route answers: a body, or — where the shape of the answer depends on
 * what was asked for — a function of the request URL.
 */
export type Answer = unknown | ((url: string) => unknown);

/**
 * Every route the screens touch, most specific first — the collections hang off
 * `/sources/:id/…`, so a pattern for `sources` would swallow them if it came
 * before theirs.
 */
export const ROUTES: Array<[RegExp, Answer]> = [
  [/\/api\/auth\/me$/, AUTH],
  [/\/api\/settings(\?|$)/, SETTINGS],
  [/\/api\/overview\//, OVERVIEW],
  [/\/api\/sources\/[^/]+\/deployments/, DEPLOYMENTS],
  [/\/api\/sources\/[^/]+\/incidents/, INCIDENTS],
  [/\/api\/sources\/[^/]+\/release-notes/, RELEASE_NOTES],
  [/\/api\/sources\/[^/]+\/repos/, REPOS],
  [/\/api\/sources\/[^/]+\/tags/, TAGS],
  [/\/api\/sources\/[^/]+\/branches/, BRANCHES],
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
  // Matched before the catalogue itself: the preview is a POST to a path the
  // pattern below would otherwise answer with a page of rules.
  [/\/api\/env-rules\/preview/, CLASSIFIED],
  [/\/api\/env-rules\?.*target=pull_request_title/, PR_TITLE_RULES],
  [/\/api\/env-rules\?.*target=environment/, ENVIRONMENT_RULES],
  [/\/api\/env-rules/, EMPTY_PAGE],
  [/\/api\/llm-providers/, LLM_PROVIDERS],
  [/\/api\/trackers/, EMPTY_PAGE],
  [/\/api\/jobs\/running/, RUNNING],
  [/\/api\/jobs\/(failures|degraded)/, EMPTY_PAGE],
  [/\/api\/jobs/, JOBS],
  [/\/api\/users/, { items: [USER], page: { total: 1, limit: 25, offset: 0 } }],
];

/**
 * The body a stubbed request is answered with: the first pattern that matches
 * it, and the empty page for anything else — an unlisted route reads as a page
 * with nothing in it rather than as a failed request.
 *
 * `extra` comes first, for a suite that answers one route differently.
 */
export function answer(url: string, extra: Array<[RegExp, Answer]> = []): unknown {
  const match = [...extra, ...ROUTES].find(([pattern]) => pattern.test(url));
  const body = match ? match[1] : EMPTY_PAGE;
  return typeof body === 'function' ? (body as (url: string) => unknown)(url) : body;
}
