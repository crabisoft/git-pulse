/**
 * Normalized types shared between the backend (NestJS) and the frontend (React).
 * Any data coming from a source (GitHub / GitLab) is reduced to these
 * platform-neutral shapes.
 */

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

// ─── Environment classification (Phase 2) ────────────────────────────

export type EnvRuleKind = 'simple' | 'meta';

/** A RegEx-based environment classification rule. */
export interface EnvRulePublic {
  id: string;
  sourceId: string;
  name: string;
  pattern: string;
  kind: EnvRuleKind;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

// ─── DORA (Phase 2) ──────────────────────────────────────────────────

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

/** A historized metric point (basis for time-series trends). */
export interface MetricSnapshotPublic {
  id: string;
  sourceId: string;
  metric: string;
  value: number;
  dimensions: Record<string, string>;
  capturedAt: string;
}

/** An environment name resolved against a set of rules. */
export interface ClassifiedEnvironment {
  name: string;
  /** Attributes extracted from named capture groups (e.g. type, client). */
  attributes: Record<string, string>;
  /** Meta-environments this environment belongs to (cumulative). */
  metaEnvironments: string[];
}

// ─── Application settings ────────────────────────────────────────────

/**
 * Application-wide settings, editable from the Settings section. Each one
 * defaults to its environment variable, then to a built-in value.
 */
export interface AppSettings {
  /** Lookback window for DORA metrics, in days (DORA_WINDOW_DAYS). */
  doraWindowDays: number;
  /** Age beyond which a PR/MR counts as stale, in hours. */
  stalePrHours: number;
  /** Cron pattern of the scheduled collection (COLLECT_CRON). */
  collectCron: string;
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
  pullRequests: PullRequest[];
  pipelines: Pipeline[];
  environments: DashboardEnvironment[];
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
