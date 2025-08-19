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

/** A computed DORA metric for one dimension combination. */
export interface DoraResult {
  metric: DoraMetric;
  /** count for frequency, seconds for durations, 0..1 ratio for CFR. */
  value: number;
  unit: 'count' | 'seconds' | 'ratio';
  dimensions: Record<string, string>;
  /** Number of events the value is derived from. */
  sampleSize: number;
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

// ─── Aggregated dashboard responses ──────────────────────────────────

export interface DashboardLive {
  sourceId: string;
  pullRequests: PullRequest[];
  pipelines: Pipeline[];
  summary: {
    openPrs: number;
    stalePrs: number;
    failedPipelines: number;
    runningPipelines: number;
  };
  /** Non-blocking errors collected while fetching. */
  warnings: CodedMessage[];
}
