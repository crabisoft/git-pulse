/**
 * Normalized types shared between the backend (NestJS) and the frontend (React).
 * Any data coming from a source (GitHub / GitLab) is reduced to these
 * platform-neutral shapes.
 */

// ─── Pagination ──────────────────────────────────────────────────────

/** Largest page size a client may ask for; higher values are rejected. */
export const PAGE_LIMIT_MAX = 200;

/**
 * Page size of a fresh install. It is only the built-in fallback: the effective
 * default is `AppSettings.pageSize`, editable from the Settings section.
 */
export const PAGE_LIMIT_DEFAULT = 10;

/** Describes the window a paginated payload was cut from. */
export interface PageInfo {
  /** Items matching the query, regardless of the window. */
  total: number;
  limit: number;
  offset: number;
  /** True when items remain after this window. */
  hasMore: boolean;
}

/** Envelope returned by every list route. */
export interface Page<T> {
  items: T[];
  page: PageInfo;
}

// ─── Sources ─────────────────────────────────────────────────────────

export type SourceKind = 'github' | 'gitlab';

export type AuthKind = 'token' | 'app';

export interface ScopeRules {
  /** Root GitHub org or GitLab group to track. */
  owner: string;
  /** Explicitly included repos/projects (empty = all under the org/group). */
  include?: string[];
  exclude?: string[];
}

/** Public representation of a source — never carries the secret. */
export interface SourcePublic {
  id: string;
  name: string;
  /**
   * URL-safe form of the name, unique across sources. The frontend routes on it
   * so links stay readable; the API itself keeps addressing sources by `id`.
   * Regenerated when the source is renamed, which invalidates older links.
   */
  slug: string;
  kind: SourceKind;
  baseUrl: string;
  authKind: AuthKind;
  scope: ScopeRules;
  createdAt: string;
  updatedAt: string;
}

// ─── Normalized entities ─────────────────────────────────────────────

export type PullRequestState = 'open' | 'merged' | 'closed' | 'draft';

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  state: PullRequestState;
  author: string;
  repo: string;
  repoUrl: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  /** Assigned reviewers — a review-load indicator. */
  reviewers: number;
  /** Hours since the PR was opened, computed on the backend. */
  ageHours: number;
}

export type PipelineStatus =
  | 'success'
  | 'failed'
  | 'running'
  | 'pending'
  | 'canceled'
  | 'skipped'
  | 'unknown';

export interface Pipeline {
  id: string;
  repo: string;
  repoUrl: string;
  ref: string;
  status: PipelineStatus;
  url: string;
  createdAt: string;
  updatedAt: string;
  /** Duration in seconds once finished, otherwise null. */
  durationSec: number | null;
}

export interface Deployment {
  id: string;
  repo: string;
  environment: string;
  ref: string;
  status: PipelineStatus;
  createdAt: string;
}

/** A merged PR/MR with the timestamps needed to derive lead time. */
export interface MergedPullRequest {
  id: string;
  repo: string;
  number: number;
  url: string;
  openedAt: string;
  firstCommitAt: string | null;
  firstReviewAt: string | null;
  mergedAt: string;
}

// ─── Localizable messages ────────────────────────────────────────────

/** A message identified by an i18n code, translated on the frontend. */
export interface CodedMessage {
  code: string;
  params?: Record<string, string | number>;
}

/** Result of a source connection test. */
export interface ConnectionTestResult {
  ok: boolean;
  message: CodedMessage;
}

// ─── Environment classification ──────────────────────────────────────

export type EnvRuleKind = 'simple' | 'meta';

/**
 * What a rule is matched against. Every target shares the same engine: named
 * capture groups become attributes. The extra targets exist so things that have
 * no environment get dimensions too — a PR has only a repo, an incident only
 * its labels.
 */
export type RuleTarget = 'environment' | 'repository' | 'incident';

/** A RegEx-based classification rule. */
export interface EnvRulePublic {
  id: string;
  sourceId: string;
  name: string;
  pattern: string;
  kind: EnvRuleKind;
  target: RuleTarget;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Incidents ───────────────────────────────────────────────────────

/**
 * A production incident, normalized across trackers. Deliberately poor: DORA
 * only needs when it started and when it was over, so every tracker-specific
 * notion of "done" (closed issue, Jira status, Linear state) collapses into
 * `resolvedAt`.
 */
export interface Incident {
  /** Provider-prefixed, like the other entity ids: `gh:repo:number`. */
  id: string;
  /** Human reference — `#42`, `OPS-123`. */
  key: string;
  title: string;
  url: string;
  openedAt: string;
  /** null while still open — an incident in progress has no restore time. */
  resolvedAt: string | null;
  /** Labels, tags or components: what the `incident` rules classify. */
  labels: string[];
  /** Repo the incident was filed against, when the tracker ties it to one. */
  repo?: string;
}

/**
 * What counts as a failure for change failure rate and MTTR.
 * - `pipelines`: a failed deployment, the historical behavior.
 * - `incidents`: an incident opened in the tracker.
 * - `both`: either signal. The rate can then exceed 100% when incidents
 *   outnumber deployments in a slice — a legible sign that the label filter or
 *   the dimensions are misaligned, which clamping would only hide.
 */
export type FailureSource = 'pipelines' | 'incidents' | 'both';

// ─── DORA ────────────────────────────────────────────────────────────

export type DoraMetric =
  | 'deployment_frequency'
  | 'lead_time'
  | 'change_failure_rate'
  | 'mttr'
  | 'coding_time'
  | 'pickup_time'
  | 'review_time';

/** One event contributing to a metric value, shown in the detail view. */
export interface DoraSample {
  /** Environment name, or repo reference for PR-based metrics. */
  label: string;
  /** Date the sample is anchored to (deployment date, merge date, ...). */
  at: string;
  /** Duration in seconds for time-based metrics, null when only counted. */
  value: number | null;
  status?: 'success' | 'failed' | 'other';
  /** Link to the underlying PR/MR, when there is one. */
  url?: string;
  /** Extra context (repo, restore date, ...) rendered as key/value pairs. */
  details?: Record<string, string>;
}

/** A computed DORA metric for one dimension combination. */
export interface DoraResult {
  metric: DoraMetric;
  /** count for frequency, seconds for durations, 0..1 ratio for CFR. */
  value: number;
  unit: 'count' | 'seconds' | 'ratio';
  dimensions: Record<string, string>;
  /** Number of events the value is derived from. */
  sampleSize: number;
  /** Most recent contributing events, capped — sampleSize keeps the real total. */
  samples: DoraSample[];
}

/**
 * Lookback windows the UI offers, in days. A month counts as 30 days and a year
 * as 365, so the labels stay round rather than calendar-exact. The API accepts
 * any value in [DORA_WINDOW_MIN, DORA_WINDOW_MAX] — these are what the dropdowns
 * propose, not what the backend enforces.
 */
export const DORA_WINDOW_PRESETS: readonly number[] = [15, 30, 60, 90, 180, 365, 730];

export const DORA_WINDOW_MIN = 1;
/** Widest window accepted, i.e. the largest preset. */
export const DORA_WINDOW_MAX = 730;

/** The period a report was computed over — ISO bounds, both inclusive. */
export interface DoraPeriod {
  from: string;
  to: string;
  /**
   * The rolling window `from` was derived from, in days, or null when an
   * explicit `from` was requested. Lets the UI show which window is in effect
   * without duplicating the fallback logic.
   */
  windowDays: number | null;
}

/**
 * The DORA endpoint payload. Beyond the paginated results it carries what the
 * filter controls need: the vocabularies are computed before filtering, so
 * narrowing a filter never empties the list you pick from.
 */
export interface DoraReport {
  results: Page<DoraResult>;
  /** Every repo in the source scope, filter applied or not. */
  repos: string[];
  /** Dimension key → observed values, over the repo-scoped results. */
  dimensions: Record<string, string[]>;
  /** The period actually used, defaults resolved. */
  period: DoraPeriod;
}

/** A historized metric point (basis for time-series trends). */
export interface MetricSnapshotPublic {
  id: string;
  sourceId: string;
  metric: string;
  value: number;
  dimensions: Record<string, string>;
  capturedAt: string;
}

/** A name (environment or repository) resolved against a set of rules. */
export interface ClassifiedEnvironment {
  name: string;
  /** Attributes extracted from named capture groups (e.g. type, client). */
  attributes: Record<string, string>;
  /** Meta-environments this environment belongs to (cumulative). */
  metaEnvironments: string[];
}

// ─── Application settings ────────────────────────────────────────────

/**
 * Application-wide settings, stored in the database and editable from the
 * Settings section. Each one falls back to a built-in value until it is saved.
 */
export interface AppSettings {
  /** Default lookback window for DORA metrics, in days — see DORA_WINDOW_PRESETS. */
  doraWindowDays: number;
  /** Age beyond which a PR/MR counts as stale, in hours. */
  stalePrHours: number;
  /** Cron pattern of the scheduled collection. */
  collectCron: string;
  /**
   * Items per page applied by every list route when the client asks for no
   * `limit`. Capped at PAGE_LIMIT_MAX.
   */
  pageSize: number;
  /** Which signals feed change failure rate and MTTR. */
  failureSource: FailureSource;
  /**
   * An issue is an incident when it carries one of these labels. Required as
   * soon as incidents are used: without it every issue in the scope would count
   * as a production failure.
   */
  incidentLabels: string[];
}

// ─── Aggregated dashboard responses ──────────────────────────────────

/**
 * An environment discovered in the deployments of a source, resolved against
 * its rules. An environment no rule matches is still listed, with empty
 * attributes and meta-environments.
 */
export interface DashboardEnvironment {
  name: string;
  /** Attributes from named capture groups — empty when no rule matches. */
  attributes: Record<string, string>;
  metaEnvironments: string[];
  /** Repos having deployed to this environment over the window. */
  repos: string[];
  deployments: number;
  lastDeployAt: string;
  lastStatus: PipelineStatus;
}

export interface DashboardLive {
  sourceId: string;
  /** Each list is windowed independently — see DashboardLiveQuery on the client. */
  pullRequests: Page<PullRequest>;
  pipelines: Page<Pipeline>;
  environments: Page<DashboardEnvironment>;
  /** Every repo in the source scope — vocabulary of the repo filter. */
  repos: string[];
  /** Computed over the whole filtered data set, not over the windows above. */
  summary: {
    openPrs: number;
    stalePrs: number;
    failedPipelines: number;
    runningPipelines: number;
    environments: number;
  };
  /** Non-blocking errors collected while fetching. */
  warnings: CodedMessage[];
}
