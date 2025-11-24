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

/**
 * Where the dashboard reads a source from.
 *
 * `live` asks the provider on every request, so the rate-limit budget is spent
 * per visitor. `stored` reads what the ingestion wrote, so it is spent per
 * collection however many people are watching.
 */
export type SourceMode = 'live' | 'stored';

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
  mode: SourceMode;
  /**
   * Whether events are accepted for this source — an acceleration on top of the
   * scheduled ingestion, never a replacement for it. Only ever true in `stored`
   * mode, and false on an install whose network refuses inbound traffic.
   */
  webhooksEnabled: boolean;
  /** Classification rules that apply to this source, from the global set. */
  envRuleIds: string[];
  /** Trackers this source's pull requests may reference. */
  trackerIds: string[];
  /**
   * Tracker its incidents are read from, among the attached ones. Null means
   * none, and then no incident is collected whatever `failureSource` says.
   * Single by design: two would leave the collector with no way to choose.
   */
  incidentTrackerId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What an admin needs to declare the hook on the provider side. Returned once,
 * by the call that generates it: the secret is stored encrypted and never read
 * back out, exactly like a source credential.
 *
 * The path is relative because the backend does not reliably know the origin it
 * is reachable at from the outside — behind a reverse proxy or a tunnel, only
 * the operator does.
 */
export interface WebhookSetup {
  path: string;
  secret: string;
}

// ─── Normalized entities ─────────────────────────────────────────────

/** Which product an issue tracker is. Decides the default link shape. */
export type TrackerKind = 'jira' | 'linear' | 'github' | 'gitlab';

/**
 * Link shape per tracker kind, used whenever a tracker defines no template of
 * its own. `{base}` is the tracker's base URL and `{key}` the extracted
 * reference; `{owner}` and `{repo}` are resolved per pull request, which is why
 * git-hosted trackers cannot be linked from a static template.
 */
export const TRACKER_URL_TEMPLATES: Record<TrackerKind, string> = {
  jira: '{base}/browse/{key}',
  linear: '{base}/issue/{key}',
  github: '{base}/{owner}/{repo}/issues/{key}',
  gitlab: '{base}/{repo}/-/issues/{key}',
};

/**
 * A source using a tracker. Written from the source — a tracker is declared
 * once and lists its sources read-only, because "what does this source use" is
 * the question one actually asks while setting things up.
 */
export interface TrackerBinding {
  sourceId: string;
  incidents: boolean;
}

/** Tracker kinds an incident provider exists for. */
export const INCIDENT_TRACKER_KINDS: readonly TrackerKind[] = ['github', 'gitlab'];

/**
 * An issue tracker, declared once and attached to the sources it serves. Its
 * base URL lives here rather than on every rule, so moving an instance is a
 * single edit.
 */
export interface TrackerPublic {
  id: string;
  name: string;
  /** URL-safe form of the name, unique across trackers. */
  slug: string;
  kind: TrackerKind;
  baseUrl: string;
  /** Null falls back to TRACKER_URL_TEMPLATES[kind]. */
  urlTemplate: string | null;
  sources: TrackerBinding[];
  createdAt: string;
  updatedAt: string;
}

/** The tracker a reference belongs to, denormalized for display. */
export interface TicketRefTracker {
  id: string;
  name: string;
  kind: TrackerKind;
}

/** A ticket referenced by a pull request. */
export interface TicketRef {
  /** The reference as written: `OPS-123`, `42`. */
  key: string;
  /** Built from the tracker's template; absent when it resolves to nothing. */
  url?: string;
  /** Which text it came from — the first thing to look at when a rule matches too much. */
  foundIn: TicketSource;
  tracker: TicketRefTracker;
}

/** Texts a ticket reference is looked for in, in that order. */
export type TicketSource = 'branch' | 'title';

/**
 * A RegEx extracting ticket references from a branch name or a PR title. Kept
 * apart from EnvRule: it yields references rather than attributes.
 *
 * It belongs to a tracker and to nothing else — a key format is a property of
 * the tracker. Which sources it applies to follows from the sources attached to
 * that tracker.
 */
export interface TicketRulePublic {
  id: string;
  trackerId: string;
  name: string;
  pattern: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

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
  /** Source branch — where ticket references are usually found. */
  headRef: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  /** Assigned reviewers — a review-load indicator. */
  reviewers: number;
  /** Hours since the PR was opened, computed on the backend. */
  ageHours: number;
  /** Tickets referenced by the branch name or the title, deduplicated. */
  tickets: TicketRef[];
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
  title: string;
  url: string;
  /** Source branch, for ticket extraction. */
  headRef: string;
  openedAt: string;
  firstCommitAt: string | null;
  firstReviewAt: string | null;
  mergedAt: string;
}

// ─── Release notes ───────────────────────────────────────────────────

/** A tag, as the platform reports it. */
export interface Tag {
  name: string;
  sha: string;
  /** Absent on lightweight tags, which carry no date of their own. */
  taggedAt: string | null;
}

/** A commit in a range, before anything is made of it. */
export interface Commit {
  sha: string;
  /** Subject and body, as written. */
  message: string;
  author: string;
  authoredAt: string;
  url: string;
}

/** One line of a release note, parsed out of a commit. */
export interface ReleaseNoteEntry {
  /** The description, with the Conventional Commits prefix removed. */
  summary: string;
  /** The `feat(scope):` part, when there is one. */
  scope: string | null;
  breaking: boolean;
  sha: string;
  author: string;
  url: string;
  /** Tickets the message mentions, read by the ticket rules. */
  tickets: TicketRef[];
}

/** Entries sharing a Conventional Commits type. */
export interface ReleaseNoteSection {
  /** `feat`, `fix`, … or `other` for what followed no convention. */
  type: string;
  entries: ReleaseNoteEntry[];
}

/** What a range of commits amounts to, structured and rendered. */
export interface ReleaseNotes {
  repo: string;
  /** The tag the range starts after; null when it starts at the beginning. */
  from: string | null;
  to: string;
  sections: ReleaseNoteSection[];
  /** Breaking changes, repeated out of their sections to lead the notes. */
  breaking: ReleaseNoteEntry[];
  markdown: string;
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

/**
 * A RegEx-based classification rule. Defined once for the whole install: a
 * pattern describes a naming convention, which rarely stops at one repository
 * host. Sources opt into the ones that apply to them.
 */
export interface EnvRulePublic {
  id: string;
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
  /**
   * Tickets the incident mentions, extracted from its title and labels by the
   * same rules that read pull requests. A ticket shared with a merged PR is
   * what ties a failure to the change that caused it.
   */
  tickets: TicketRef[];
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
  | 'review_time'
  | 'deploy_time';

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

/** One point of a historised metric, after bucketing. */
export interface MetricPoint {
  /** Start of the bucket, ISO. */
  at: string;
  value: number;
}

/**
 * A metric's history for one dimension combination, ready to plot. Bucketed
 * server-side: the collection runs every few minutes, so a year of raw
 * snapshots is tens of thousands of rows that no chart can use and no page
 * window can carry.
 */
export interface MetricSeries {
  metric: string;
  dimensions: Record<string, string>;
  bucket: MetricBucket;
  points: MetricPoint[];
  /** Snapshots the points were derived from — what "no data yet" looks like. */
  snapshotCount: number;
}

export type MetricBucket = 'hour' | 'day' | 'week';

/** A name (environment or repository) resolved against a set of rules. */
export interface ClassifiedEnvironment {
  name: string;
  /** Attributes extracted from named capture groups (e.g. type, client). */
  attributes: Record<string, string>;
  /** Meta-environments this environment belongs to (cumulative). */
  metaEnvironments: string[];
}

// ─── API quotas ──────────────────────────────────────────────────────

/** Whose credentials a series of API calls is billed to. */
export type QuotaSubject = 'source' | 'tracker';

/**
 * Where the ceiling comes from. `observed` was read from the provider's
 * rate-limit headers; `declared` was entered by hand, for the instances that
 * send none. The distinction is shown, so a supposition never reads as a
 * measurement.
 */
export type QuotaOrigin = 'observed' | 'declared';

/**
 * Consumption of one provider rate-limit bucket. A subject has as many as the
 * provider meters separately: GitHub counts REST, GraphQL and search apart, on
 * windows of different lengths, which is why the window travels with the row.
 */
export interface ApiQuotaPublic {
  subjectKind: QuotaSubject;
  subjectId: string;
  /** Provider bucket name — "core", "graphql", "search", "rest" for GitLab. */
  bucket: string;
  limit: number;
  used: number;
  /** `limit - used`, floored at 0 — providers occasionally report an overshoot. */
  remaining: number;
  /** ISO date at which the counter goes back to zero. */
  resetAt: string;
  /** Window length in seconds, when the provider states one we know of. */
  windowSec: number | null;
  origin: QuotaOrigin;
  /** ISO date of the last call that fed this row. */
  observedAt: string;
}

/**
 * A ceiling stated by hand, for the instances that meter nothing — a
 * self-hosted GitLab with rate limiting switched off sends no header to read.
 *
 * Configuration rather than reading, which is why it lives apart from
 * `ApiQuotaPublic`: the quota row it feeds is recomputed at every window, where
 * what was declared must survive them all.
 */
export interface ApiBudgetPublic {
  subjectKind: QuotaSubject;
  subjectId: string;
  /** Bucket the ceiling applies to — see `QUOTA_BUCKET_BY_KIND`. */
  bucket: string;
  /** Calls allowed per window. */
  limit: number;
  /** Window length, in seconds. */
  windowSec: number;
  updatedAt: string;
}

/** Fields a budget is declared with; the subject and bucket address it. */
export interface ApiBudgetInput {
  limit: number;
  windowSec: number;
}

/**
 * The bucket a source's calls are charged to when nothing names one. Only the
 * providers' main bucket can be declared: the others (GitHub's `graphql`,
 * `search`) are metered by every instance that has them, so a figure typed for
 * them would compete with a measurement.
 */
export const QUOTA_BUCKET_BY_KIND: Record<SourceKind, string> = {
  github: 'core',
  gitlab: 'rest',
};

/** Guard rails on a declared budget — a window of a second meters nothing. */
export const QUOTA_WINDOW_SEC_MIN = 60;
export const QUOTA_WINDOW_SEC_MAX = 86_400;
export const QUOTA_LIMIT_MIN = 1;

// ─── Accounts and access ─────────────────────────────────────────────

/**
 * Coarse on purpose. `admin` configures the install — sources, rules, trackers,
 * settings; `user` only reads what `publicDashboard` would otherwise open to
 * everyone, which is the whole point of having the role at all.
 */
export type UserRole = 'admin' | 'user';

/**
 * Enforced when a password is set, and shown as a hint before it is. Long
 * rather than exotic: a length floor is the only rule that reliably helps, and
 * the accounts here are handed out by an admin, not opened by the public.
 */
export const PASSWORD_MIN_LENGTH = 10;

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

/**
 * A freshly issued reset link. The token is readable exactly once, in the
 * answer that created it — only its digest is kept, so an admin who loses it
 * issues another rather than looking it up.
 */
export interface PasswordResetIssued {
  token: string;
  expiresAt: string;
}

/** Whose password a reset link would change, shown before it is used. */
export interface PasswordResetTarget {
  email: string;
  name: string;
}

/** Who the caller is, and what the install lets an anonymous visitor do. */
export interface AuthState {
  user: UserPublic | null;
  /** Dashboard and DORA readable without signing in. */
  publicDashboard: boolean;
  /**
   * No account exists yet, so the first one may be created without signing in.
   * Closes for good as soon as there is one.
   */
  setupRequired: boolean;
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
  /**
   * Dashboard and DORA readable without an account. Off, the whole application
   * asks for one — settings always did, whatever this says.
   */
  publicDashboard: boolean;
  /** Which signals feed change failure rate and MTTR. */
  failureSource: FailureSource;
  /**
   * An issue is an incident when it carries one of these labels. Required as
   * soon as incidents are used: without it every issue in the scope would count
   * as a production failure.
   */
  incidentLabels: string[];
  /**
   * Share of a rate-limit budget kept in reserve, in percent. Below it the
   * collection drops its optional work — the per-pull-request and
   * per-deployment enrichment calls — rather than spending the last of the
   * budget on them and being refused the calls that carry the metrics.
   *
   * Zero switches the degradation off: everything is attempted until the
   * provider says no.
   */
  quotaReservePct: number;
}

/** Bounds of `quotaReservePct`; a reserve of everything would collect nothing. */
export const QUOTA_RESERVE_PCT_MIN = 0;
export const QUOTA_RESERVE_PCT_MAX = 90;

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
  mode: SourceMode;
  /**
   * When the stored view was last brought up to date, as the stalest of its
   * listings has it. Null in `live` mode, where the data is of the instant, and
   * null in `stored` mode before the first synchronisation — where the view is
   * not current but empty, which the warnings say.
   */
  syncedAt: string | null;
  /** Non-blocking errors collected while fetching. */
  warnings: CodedMessage[];
}
