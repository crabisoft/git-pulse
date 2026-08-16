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

/**
 * How a repository is exposed by its platform. `internal` — visible to the
 * whole instance, to nobody outside — exists on GitLab and on GitHub
 * Enterprise, and is neither of the other two: an install that tracks its
 * private work and not its open source has to be able to say where it falls.
 */
export type RepoVisibility = 'public' | 'private' | 'internal';

/** A repository as the platform lists it, before any scope is applied. */
export interface RepositoryRef {
  name: string;
  visibility: RepoVisibility;
}

export interface ScopeRules {
  /** Root GitHub org or GitLab group to track. */
  owner: string;
  /** Explicitly tracked repos/projects. */
  include?: string[];
  /** Explicitly left out. Wins over everything else, `trackNewRepos` included. */
  exclude?: string[];
  /**
   * Whether a repository the owner gains later is tracked without anybody
   * naming it. Absent means the historical reading — everything, unless an
   * include list says otherwise — so a scope written before this existed keeps
   * covering exactly what it covered.
   */
  trackNewRepos?: boolean;
}

/**
 * Whether a scope covers a repository. The one place the rule is stated: the
 * backend filters collections with it and the source form ticks its boxes from
 * it, and the two disagreeing would show a selection that is not the one being
 * collected.
 */
export function scopeTracks(scope: ScopeRules, repo: string): boolean {
  if (scope.exclude?.includes(repo)) return false;
  if (scope.include?.includes(repo)) return true;
  return scope.trackNewRepos ?? (scope.include ?? []).length === 0;
}

/**
 * Turns a selection made against a known catalogue back into a scope.
 *
 * Only the side that contradicts the default is written down: with new repos
 * tracked, naming every kept one would say nothing the default does not, and
 * the list would rot as the org grows. What is stored is therefore the shorter
 * of the two lists, and re-reading it through `scopeTracks` gives the selection
 * back unchanged.
 */
export function scopeFromSelection(
  catalogue: readonly string[],
  selected: ReadonlySet<string>,
  trackNewRepos: boolean,
): Pick<ScopeRules, 'include' | 'exclude' | 'trackNewRepos'> {
  return trackNewRepos
    ? { include: [], exclude: catalogue.filter((repo) => !selected.has(repo)), trackNewRepos }
    : { include: catalogue.filter((repo) => selected.has(repo)), exclude: [], trackNewRepos };
}

/**
 * The languages the interface is translated into.
 *
 * Here rather than in the frontend that renders them: an account now stores
 * which one it reads, so the API validates it — and a list in two places is a
 * list that will disagree the day a third language lands.
 */
export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

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
  /**
   * How far back the ingestion reads for this source, in days. Only meaningful
   * in `stored` mode, where it is what decides how much history a first
   * collection brings back — a live source is of the instant.
   *
   * Null follows the reporting window, which is what every source did before
   * the field existed. Setting it deeper than the window is the point of having
   * it: the store then holds more than the current window reads, and widening
   * the window later finds it already there.
   */
  historyDays: number | null;
  /**
   * The source a reader lands on when the address names none.
   *
   * At most one across the install, and possibly none: with a single source
   * there is nothing to choose between, and the first one answers. What it
   * changes is which board opens on an install that watches several.
   */
  isDefault: boolean;
  /** Classification rules that apply to this source, from the global set. */
  envRuleIds: string[];
  /** Version rules this source's environments are read with, from the global set. */
  versionRuleIds: string[];
  /** Address rules deriving where this source's environments answer. */
  envUrlRuleIds: string[];
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
 * How far back one table actually reaches for a source.
 *
 * `days` is what it is read for — how deep a report can ask before it runs out
 * of rows — and is counted from the oldest row to now rather than to the newest
 * one: a source that stopped being collected last month has an old history, not
 * a short one.
 */
export interface CoverageSpan {
  /** Oldest row, ISO. Null when the table holds none for this source. */
  from: string | null;
  /** Newest row, ISO. Null likewise. */
  to: string | null;
  /** Whole days from the oldest row to now, at least 1. Null when there is none. */
  days: number | null;
  count: number;
}

/**
 * What a source actually holds, table by table, against what it was configured
 * to hold.
 *
 * The point of stating both: a source asked for a year of depth but collected
 * for a week has a week, and every report over a longer period is answering
 * from data that does not exist. Nothing else on the page says that.
 *
 * The metrics span is separate from the rest, and deliberately: DORA readings
 * are historized by the collection rather than ingested, so they start the day
 * an install starts collecting — never earlier, however deep the store is.
 */
export interface SourceCoverage {
  sourceId: string;
  mode: SourceMode;
  /**
   * How far back the ingestion is configured to read, in days — the source's
   * own depth, or the reporting window when it states none. Null in `live`
   * mode, which stores nothing and has no depth to speak of.
   */
  depthDays: number | null;
  /** What the sweep keeps: the depth plus the configured margin. Null in `live` mode. */
  retainedDays: number | null;
  deployments: CoverageSpan;
  /**
   * Counted from the oldest pull request, opened ones included — and those the
   * sweep never deletes, so this one can legitimately reach further back than
   * `retainedDays`.
   */
  pullRequests: CoverageSpan;
  pipelines: CoverageSpan;
  /** Historized DORA readings — what a trend can be drawn from, and nothing else. */
  metrics: CoverageSpan;
}

/**
 * What an admin needs to declare the hook on the provider side. Returned once,
 * by the call that generates it: the secret is stored encrypted and never read
 * back out, exactly like a source credential.
 */
export interface WebhookSetup {
  /**
   * Path to deliver to, API prefix included — `/api/webhooks/<sourceId>`. The
   * full URL is that appended to the domain the application answers on:
   * `https://<app-domain>/api/webhooks/<sourceId>`.
   *
   * A path and not a URL because the backend does not reliably know the origin
   * it is reachable at from the outside: behind a reverse proxy or a tunnel,
   * only the operator does.
   */
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
export type TicketSource = 'branch' | 'title' | 'body' | 'commit';

/**
 * Reading order, and the order a rule's texts are scanned in: cheapest and most
 * reliable first, so a key found in several of them is attributed to the branch
 * that named it rather than to the message that repeated it.
 */
export const TICKET_SOURCES: readonly TicketSource[] = ['branch', 'title', 'body', 'commit'];

/**
 * A RegEx extracting ticket references from a branch name, a PR title, a PR
 * description or a commit message. Kept apart from EnvRule: it yields
 * references rather than attributes.
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
  /**
   * Which texts the pattern is run over. Never empty: a rule reading nothing
   * would match nothing, which is a rule one deletes rather than one one saves.
   */
  sources: TicketSource[];
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
  /**
   * Where the deployed environment can be reached, when the platform states
   * one. Read, never built: the address of a deployed application is not
   * derivable from anything we hold, so a guess would be a broken link.
   *
   * Null is the common case. GitHub carries it on a deployment status, which is
   * the call given up under the API reserve; GitLab carries it on the
   * environment, and only when one was configured with an external URL.
   */
  environmentUrl: string | null;
  /**
   * Where the deployment itself can be read on the platform. Like the address
   * above it is stated, never guessed — but this one is about the record, not
   * about what it deployed.
   *
   * Neither platform publishes a page for the deployment record itself, so what
   * comes back is the nearest thing each one does publish: on GitHub the run
   * its status points at — null when no status names one, and null too when the
   * status call was given up under the API reserve — and on GitLab the job that
   * performed it, or the environment it went to when no job did.
   */
  url: string | null;
}

// ─── Deployments ─────────────────────────────────────────────────────

/**
 * A deployment with its environment resolved against the classification rules.
 * The attributes are the same ones DORA slices on, so a row on the deployments
 * page and a slice of a metric mean the same thing by construction.
 */
export interface ClassifiedDeployment extends Deployment {
  /** Attributes from named capture groups — empty when no rule matches. */
  attributes: Record<string, string>;
  metaEnvironments: string[];
  /**
   * The platform's page for the deployed ref. Unlike an environment's address
   * this is derivable, so it is built rather than read — and the front never
   * learns which platform it came from.
   */
  refUrl: string;
}

/**
 * What the deployments endpoint answers. Beyond the page it carries the
 * vocabularies the filter controls need, computed **before** filtering — so
 * narrowing one filter never empties the list you pick the next one from.
 */
export interface DeploymentReport {
  deployments: Page<ClassifiedDeployment>;
  /** Every repo in the source scope, filter applied or not. */
  repos: string[];
  /** Every environment seen over the period, before the environment filter. */
  environments: string[];
  /** Statuses seen over the period — a vocabulary, not the enum. */
  statuses: PipelineStatus[];
  /** Dimension key → observed values, over the repo-scoped deployments. */
  dimensions: Record<string, string[]>;
  /**
   * What each **listed deployment's** environment was answering while that
   * deployment was live, frozen at the time — never the environment's current
   * version.
   *
   * At most one entry per row and often fewer: a deployment replaced before a
   * probe reached it has none, for good, since a version cannot be read after
   * the fact. A row missing from here is a fact about that deployment.
   */
  versions: DeploymentVersion[];
  /**
   * What each environment is running **now**, one entry per (repo,
   * environment).
   *
   * Carried beside the frozen rows rather than instead of them, because the two
   * are complementary and not competing. Everything deployed before version
   * rules existed has no frozen row and never will; the current reading is all
   * there is to say about those environments, and saying nothing would leave a
   * page that is permanently blank on its history.
   *
   * The page may only put this on the **most recent** deployment of a pair, and
   * must mark it as the environment's current state rather than as something
   * that deployment is known to have delivered. On any older row it would be
   * plainly false: something newer went out since.
   */
  currentVersions: EnvironmentVersion[];
  /**
   * How many version rules this source has attached.
   *
   * What decides whether the page shows the column at all — and deliberately
   * not "are there any readings". A source that was configured five minutes ago
   * has rules and no readings, and that is exactly when somebody is looking for
   * the column to find out why it is empty. Answered here because the frontend
   * cannot tell "nobody configured this" from "configured, nothing read yet".
   */
  versionRules: number;
  period: DoraPeriod;
}

/**
 * What a deployment's contents are compared against.
 *
 * - `previous`: the ref of the last successful deployment of the same repo to
 *   the same environment — "what went out since the last time".
 * - `default`: the repo's default branch — "what this ref adds on top of main",
 *   which is also the history since it diverged from it.
 * - `ref`: a tag, a branch or a commit named by the reader. The two above
 *   answer the questions asked most often; this one exists because they are not
 *   the only questions — "since the release we rolled back from" is a tag, and
 *   "since that fix" is a sha.
 *
 * - `nearest`: the branch the deployed ref last shared a commit with — the
 *   closest thing to a fork point the history can be made to say. The platforms
 *   record nothing about which branch a branch was cut from, so it is read back
 *   out of the merge bases: whichever branch parted from this ref most recently
 *   is the one it grew out of. It costs a comparison per candidate, which is
 *   why the archive asks for it only when the previous deployment carried
 *   nothing and there is otherwise nothing to show.
 */
export type DeploymentBase = 'previous' | 'default' | 'ref' | 'nearest';

/** What a deployment carried, against the base that was asked for. */
export interface DeploymentChanges {
  /**
   * The deployment itself, so the page that shows this can stand on its own —
   * a link pasted into a chat has to open without the list that produced it.
   */
  deployment: ClassifiedDeployment;
  repo: string;
  /** The deployed ref. */
  head: string;
  base: DeploymentBase;
  /**
   * The ref the base resolved to. Null when `previous` was asked for and the
   * period holds no earlier successful deployment — there is nothing to compare
   * against, which is a fact about the data and not an error.
   */
  baseRef: string | null;
  /** The platform's page for `baseRef`, null exactly when that one is. */
  baseRefUrl: string | null;
  /** Commits reachable from `head` but not from `baseRef`, parsed. */
  entries: ReleaseNoteEntry[];
  /** Distinct authors — a cheap sense of how wide the change is. */
  authors: number;
  /** The same entries rendered, through the configured generator. */
  markdown: string;
  /**
   * When this was written to the archive, or null when it was just computed.
   *
   * Not decoration: an archived answer is the one that was true at the time,
   * and it is the only one still available once the branch is deleted or the
   * deployment aged out of the provider's API. A reader comparing two of these
   * has to know which is a recollection and which is a reading.
   */
  archivedAt: string | null;
}

// ─── Deployment changelogs ───────────────────────────────────────────

/**
 * What a deployment was, as it was written down at the time.
 *
 * Deployments are the most perishable thing this install reports on: the
 * environment is torn down, its branch deleted, the record aged out of the API,
 * and the comparison that produced these lines can never be made again. So the
 * archive keeps the answer rather than the means of computing it — every field
 * below stands on its own, including the links.
 */
export interface DeploymentChangelogSummary {
  id: string;
  /** The deployment's identity on the provider — what the archive is keyed on. */
  deploymentId: string;
  repo: string;
  environment: string;
  /** The deployed ref, and the ref it was compared against. */
  ref: string;
  baseRef: string | null;
  base: DeploymentBase;
  refUrl: string;
  baseRefUrl: string | null;
  /** The platform's page for the deployment, and the address it went to. */
  deploymentUrl: string | null;
  environmentUrl: string | null;
  status: PipelineStatus;
  /** Distinct authors over the range, and how many commits it held. */
  authors: number;
  commits: number;
  /**
   * Filed without contents, the platform having refused to resolve the refs by
   * the time the archiver got there — a branch deleted on merge, a commit
   * pruned. The record still says something true and unobtainable elsewhere:
   * this went out, on this ref, at this time, and what it carried is no longer
   * knowable by anyone.
   */
  unreadable: boolean;
  generator: ReleaseNotesGenerator;
  deployedAt: string;
  archivedAt: string;
}

/**
 * The same record with what it says, rather than what it is about.
 *
 * Split from the summary because the history page lists hundreds of these and
 * reads one: carrying every commit message of every release to draw a table of
 * dates would be most of the payload, and none of what the table shows.
 */
export interface DeploymentChangelog extends DeploymentChangelogSummary {
  entries: ReleaseNoteEntry[];
  markdown: string;
}

/** What narrows the archive. Every field is optional; all of them narrow. */
export interface ChangelogFilters {
  repos?: string[];
  environments?: string[];
  /** Matched against the commit summaries and the deployed ref. */
  search?: string;
}

/**
 * The archive endpoint payload.
 *
 * The vocabularies come from the archive itself rather than from the
 * deployments listing: a repo that stopped deploying six months ago is exactly
 * what somebody reading this page is looking for, and the listing no longer
 * knows it existed.
 */
export interface ChangelogReport {
  changelogs: Page<DeploymentChangelogSummary>;
  repos: string[];
  environments: string[];
  /** When the archiver last wrote for this source, null before its first run. */
  lastArchivedAt: string | null;
}

/** What one archiving run did, as the collection job reports it. */
export interface ChangelogArchiveOutcome {
  /** Deployments the run wrote a changelog for. */
  archived: number;
  /** Already filed, so nothing was spent on them. */
  known: number;
  /**
   * Left for the next run — the per-run cap, or a rate-limit budget down to its
   * reserve. Nothing is lost by it: the deployments stay in the store, and the
   * next cycle picks them up where this one stopped.
   */
  deferred: number;
  /**
   * Deployments the platform would not resolve the refs of, filed as having no
   * readable contents. Not retried: a compare that answers 404 does not answer
   * otherwise later, and one retried every cycle would hold the batch against
   * the deployments that can still be read.
   */
  unreadable: number;
  /**
   * Deployments that failed for any other reason — a network blip, a 5xx. Left
   * unfiled and retried on the next run, and lost for good once they fall out
   * of the store, which is what makes them worth reporting rather than logging.
   */
  failed: number;
}

// ─── Installed versions ──────────────────────────────────────────────

/**
 * How a response is read. `json` and `xml` are parsed into the same tree and
 * addressed by path; `text` is the escape hatch for what is neither — a body
 * holding a version and a newline, a page carrying it in a meta tag — and is
 * read by a regex whose named groups the template refers to.
 */
export type VersionFormat = 'json' | 'xml' | 'text';

/**
 * What a probe sends to be let in. The secret itself never appears in a rule:
 * it lives encrypted beside the platform tokens, and the API answers with
 * `hasSecret` alone.
 */
export type VersionAuthKind = 'none' | 'bearer' | 'basic' | 'header';

/**
 * How a reading turned out.
 *
 * `skipped` is not a degraded `unreachable`: it says no request was made, which
 * is the ordinary outcome for a rule addressing an environment URL the platform
 * does not publish. Reported rather than left blank, because "we never asked"
 * and "we asked and got nothing" are fixed by different things.
 */
export type VersionProbeStatus = 'ok' | 'unreachable' | 'noMatch' | 'skipped';

/** A version rule as the API hands it over — never with its secret. */
export interface VersionRulePublic {
  id: string;
  name: string;
  /** Pattern the environment name must match. Null means every environment. */
  environment: string | null;
  /** Pattern the repo must match. Null means every repo. */
  repo: string | null;
  /** Placeholders: `{environmentUrl}` `{repo}` `{environment}` `{ref}` `{attr.*}`. */
  urlTemplate: string;
  format: VersionFormat;
  /** Literal text and `{path}` placeholders resolved against the response. */
  template: string;
  /** The regex `text` reads groups from. Null for the parsed formats. */
  pattern: string | null;
  /** Extra request headers, secrets excluded. */
  headers: Record<string, string>;
  authKind: VersionAuthKind;
  /** Header name when `authKind` is `header`. Null otherwise. */
  authHeader: string | null;
  /** Whether a secret is stored. The secret itself never leaves the backend. */
  hasSecret: boolean;
  /** Lower wins when two rules claim the same environment. */
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * What an environment is currently running, as last read.
 *
 * A failed reading is a reading: the row carries its status and the coded reason
 * rather than disappearing, because an environment that stopped answering is
 * something a reader has to be told about — a version silently frozen at last
 * week's value would be read as a deployment that never went out.
 */
export interface EnvironmentVersion {
  repo: string;
  environment: string;
  /** Null when the last reading produced none — see `status`. */
  version: string | null;
  /** The deployment that was live when this was read, when one was known. */
  deploymentId: string | null;
  /** The ref that deployment carried, for the comparison the UI draws. */
  ref: string | null;
  /** The rule that answered, null when none applied. */
  ruleId: string | null;
  /** The address actually read, null when nothing was requested. */
  url: string | null;
  status: VersionProbeStatus;
  /** Why the reading produced nothing. Null when it did. */
  error: CodedMessage | null;
  /**
   * The environment resolved against the source's classification rules — the
   * same attributes a deployment of that (repo, environment) carries, and
   * resolved the same way, so a grid crossing `client` and a metric sliced on
   * `client` mean the same thing.
   *
   * Attached on the way out rather than stored: rules are configuration, and a
   * rule corrected today has to apply to readings taken yesterday.
   */
  attributes: Record<string, string>;
  /**
   * The meta-environments this environment belongs to, from the same
   * resolution. Carried beside the attributes because a reader narrowing on
   * `production` expects the version grid to narrow with everything else.
   */
  metaEnvironments: string[];
  observedAt: string;
  /** When the version last differed from the reading before it. */
  changedAt: string | null;
}

/**
 * What one deployment's environment was answering while it was the live one.
 *
 * The counterpart of `EnvironmentVersion`, and the questions differ: that one
 * says what an environment runs now and is overwritten at every reading, this
 * one says what a deployment was confirmed to have put there and survives the
 * next deployment — and the sweep that takes the deployment row itself.
 *
 * A deployment with no row at all is the ordinary case for anything replaced
 * before a probe reached it, and it is **not recoverable**: asking an
 * environment today what it ran yesterday answers about today. So the absence
 * has to be shown as its own state rather than as a blank cell.
 */
export interface DeploymentVersion {
  /** The deployment this froze, as the connectors identify it. */
  deploymentId: string;
  repo: string;
  environment: string;
  /** What the deployment carried, kept so the reading can still be judged. */
  ref: string;
  deployedAt: string;
  /** Null when the reading produced none — `status` says why. */
  version: string | null;
  ruleId: string | null;
  url: string | null;
  status: VersionProbeStatus;
  error: CodedMessage | null;
  observedAt: string;
  /**
   * Seconds between the deployment and the reading. A version read three
   * seconds after a deployment is much weaker evidence than one read ten
   * minutes later, and the reader is the one who has to weigh that.
   */
  delaySec: number;
}

/**
 * One version arriving on an environment, and how long it stayed.
 *
 * The entries `VersionChange` was written for: not what runs there, but what
 * has run there and in what order — the only record that survives the version
 * after it.
 */
export interface VersionChangeEntry {
  version: string;
  /** When this version was first read on the environment. */
  observedAt: string;
  /**
   * When the next version replaced it, or null for the one still running.
   *
   * Read off the neighbouring change rather than stored, which makes it a
   * property of a *pair* of rows — so a page boundary has to be crossed to
   * compute the first entry of any page but the first. The backend over-reads
   * by one row for exactly that reason: a duration that is right in the middle
   * of a page and wrong at every joint would be worse than no duration at all.
   */
  until: string | null;
  /**
   * The deployment that put it there, when one did.
   *
   * **Null is the interesting case**, not the degenerate one: the version
   * changed and nothing in the platform explains it — a container restarted by
   * hand on an older image, a rollback done outside the pipeline, a drift
   * nobody declared. It is the one thing this table knows that the frozen
   * per-deployment rows cannot.
   */
  deploymentId: string | null;
  ref: string | null;
}

/** A pair's timeline, and where its record begins. */
export interface VersionHistory {
  changes: Page<VersionChangeEntry>;
  /**
   * The oldest change on record for this pair, null when there is none.
   *
   * What stops a short timeline from being read as a stable environment: the
   * record starts when the rule started reading, and a rule written yesterday
   * has nothing to say about last month. Silence is not evidence, and this is
   * what lets the page say so.
   */
  firstSeenAt: string | null;
}

/** What one probing run did, as the collection job reports it. */
export interface VersionProbeOutcome {
  /** Environments a request was actually made for. */
  probed: number;
  /** Read recently enough, or addressed by a rule that had nothing to say. */
  skipped: number;
  /** Asked and got nothing usable back. */
  failed: number;
  /** Readings that differed from the one before them. */
  changed: number;
  /**
   * Version rules attached to this source. Zero is the reason a run did
   * nothing far more often than anything else, and four zeroes above cannot
   * say it — "finished" would be a polite lie to somebody who just asked for a
   * reading and got none.
   */
  rules: number;
  /**
   * Environments the rules could have been applied to — the latest successful
   * deployment of each. Zero with rules attached is a diagnosis nothing else
   * gives: the rules are fine and no deployment has ever been collected for
   * them to describe.
   */
  environments: number;
}

/**
 * What the rule editor gets back when it tries a rule out.
 *
 * `tree` is the response as the resolver sees it — after the XML normalisation,
 * not before — because the editor builds paths by clicking through it. Handing
 * over the raw body and letting the front parse it again would put a second
 * implementation of the same normalisation on the other side of the wire, and
 * the paths it produced would be right only as long as the two agreed.
 */
export interface VersionPreview {
  /** Null when the body could not be parsed, and in `text` mode. */
  tree: unknown;
  /** What the template produced. Null when it produced nothing. */
  version: string | null;
  /** Why it produced nothing. Null when it did. */
  reason: CodedMessage | null;
  /** The address read, null when the preview was given a body instead. */
  url: string | null;
  httpStatus: number | null;
  /** The body as received, truncated — what the editor shows beside the tree. */
  body: string;
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
  /**
   * When the oldest commit of the branch was **written** — the authored date,
   * on both platforms, never the committed one.
   *
   * The two diverge the moment a branch is rebased: rebasing rewrites when a
   * commit was deposited and preserves when it was written. Reading the
   * deposited date would restart the coding time at every rebase, and would
   * mean something different on each platform — which it did, GitHub reading
   * one and GitLab the other.
   *
   * Null where the platform was not asked: these are the first calls given up
   * under the API reserve, and a pull request without one leaves the coding and
   * lead time samples rather than entering them at zero.
   */
  firstCommitAt: string | null;
  firstReviewAt: string | null;
  mergedAt: string;
  /**
   * Labels as the platform reports them: what the `pull_request` rules
   * classify. Read off the listing payload both platforms already answer, so
   * they cost nothing — unlike the changed paths, which they describe better
   * and which neither platform states without a call of its own.
   *
   * Empty on a request carrying none, and on a row stored before the column
   * existed. The two read alike: no label matches no rule either way.
   */
  labels: string[];
}

// ─── Release notes ───────────────────────────────────────────────────

/** A tag, as the platform reports it. */
export interface Tag {
  name: string;
  sha: string;
  /** Absent on lightweight tags, which carry no date of their own. */
  taggedAt: string | null;
}

/**
 * A branch, as the platform reports it. A range bound may be either a tag or a
 * branch: the platforms compare refs, not releases, and "everything on `main`
 * since the last tag" is what a release about to be cut actually is.
 */
export interface Branch {
  name: string;
  sha: string;
  /**
   * The repo's default branch. Worth knowing rather than merely displaying: an
   * omitted `to` on a repo with no tag resolves to exactly this.
   */
  isDefault: boolean;
}

/** A commit in a range, before anything is made of it. */
export interface Commit {
  sha: string;
  /** Subject and body, as written. */
  message: string;
  author: string;
  authoredAt: string;
  url: string;
  /**
   * How many parents it has — one for an ordinary commit, two or more for a
   * merge.
   *
   * Carried because it is what tells a merge from a squash, and the two want
   * opposite treatment: a merge's branch commits are already in the range,
   * being reachable from the head it was compared to, while a squash's are
   * nowhere in it and have to be fetched from the request. Guessing from the
   * message instead would read `fix: thing (#42)` as a squash and a fork's
   * `Merge branch 'main'` as a request.
   */
  parents: number;
}

/**
 * The pull/merge request a commit came in on, as a note cites it.
 *
 * Number and address only: what a release note needs of a request is a link to
 * open, and its title is the commit summary sitting right beside it.
 */
export interface PullRequestRef {
  number: number;
  url: string;
}

/** One line of a release note, parsed out of a commit. */
export interface ReleaseNoteEntry {
  /** The description, with the Conventional Commits prefix removed. */
  summary: string;
  /**
   * The commit message as written, whole — subject and body.
   *
   * A list shows the summary above, which is one line and sometimes not even
   * the subject: a `BREAKING CHANGE:` footer replaces it. This is what the
   * reader unfolds or hovers to see what the commit actually said, and the only
   * place the body survives at all — nothing else here keeps it.
   */
  message: string;
  /** The `feat(scope):` part, when there is one. */
  scope: string | null;
  breaking: boolean;
  sha: string;
  author: string;
  url: string;
  /** Tickets the message mentions, read by the ticket rules. */
  tickets: TicketRef[];
  /**
   * The request that brought the commit in, when it could be established —
   * from the merge commit the platform generated, or from the association it
   * answers for a sha. Null for a commit pushed straight to a branch, and null
   * too when the lookup was given up under the API reserve.
   */
  pullRequest: PullRequestRef | null;
}

/** Entries sharing a Conventional Commits type. */
export interface ReleaseNoteSection {
  /** `feat`, `fix`, … or `other` for what followed no convention. */
  type: string;
  entries: ReleaseNoteEntry[];
}

/**
 * What renders the Markdown of a release note.
 *
 * `builtin` reads every commit, whatever convention it follows, and keeps the
 * tickets the ticket rules found. `conventional-changelog` hands the range to
 * the package the Conventional Commits ecosystem publishes: named sections,
 * the customary layout — and its rules, which drop a commit that follows no
 * convention. It is the right choice exactly when a repo holds the convention.
 *
 * The structured sections below are unaffected either way: they are the page's
 * own reading of the commits, and they list everything.
 */
export type ReleaseNotesGenerator = 'builtin' | 'conventional-changelog';

export const RELEASE_NOTES_GENERATORS: readonly ReleaseNotesGenerator[] = [
  'builtin',
  'conventional-changelog',
];

/** What a range of commits amounts to, structured and rendered. */
export interface ReleaseNotes {
  repo: string;
  /** The tag the range starts after; null when it starts at the beginning. */
  from: string | null;
  to: string;
  /** The platform's page for each bound, null exactly when the bound is. */
  fromUrl: string | null;
  toUrl: string;
  sections: ReleaseNoteSection[];
  /** Breaking changes, repeated out of their sections to lead the notes. */
  breaking: ReleaseNoteEntry[];
  markdown: string;
  /** Which generator produced `markdown` — the sections never depend on it. */
  generator: ReleaseNotesGenerator;
}

// ─── AI providers ────────────────────────────────────────────────────

/**
 * Which vendor's API a provider talks to. It decides the request shape and the
 * authentication header — not the model, which is a free string because vendors
 * rename theirs far more often than they change their API.
 */
export type LlmKind = 'anthropic' | 'openai' | 'google' | 'mistral';

export const LLM_KINDS: readonly LlmKind[] = ['anthropic', 'openai', 'google', 'mistral'];

/** Endpoint a kind is called at when a provider declares no base URL. */
export const LLM_BASE_URLS: Record<LlmKind, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  google: 'https://generativelanguage.googleapis.com',
  mistral: 'https://api.mistral.ai',
};

/**
 * Model the form prefills, where we can state one that is current. Null means
 * the field starts empty on purpose: a model identifier we cannot vouch for
 * would be worse than none, since the failure only shows up at the first call.
 */
export const LLM_DEFAULT_MODELS: Record<LlmKind, string | null> = {
  anthropic: 'claude-opus-5',
  openai: null,
  google: null,
  mistral: 'mistral-large-latest',
};

/**
 * A model API the install may call, declared once with its key. Several may
 * coexist — one per vendor, or two of the same vendor on different models — and
 * the caller picks which one it wants.
 */
export interface LlmProviderPublic {
  id: string;
  name: string;
  kind: LlmKind;
  /** Vendor model identifier, as the vendor spells it. */
  model: string;
  /** Null uses LLM_BASE_URLS[kind]; set for a gateway or a proxy. */
  baseUrl: string | null;
  /** The one a caller gets when it names none. At most one row carries it. */
  isDefault: boolean;
  /** Whether a key is on file. The key itself is never returned. */
  hasKey: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the rewriting asks for, and which provider is to do it. */
export interface RewriteRequest {
  /** The generated notes, as Markdown. Nothing else is sent to the vendor. */
  markdown: string;
  /** Omitted, the default provider — and an error when there is none. */
  providerId?: string;
  /** BCP 47 tag the notes should be written in. Omitted, the source language. */
  language?: string;
}

/** The rewritten notes, and what produced them. */
export interface RewriteResult {
  markdown: string;
  providerId: string;
  providerName: string;
  model: string;
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
 *
 * `repository` classifies a pull request by the name of the repo it belongs to,
 * which says nothing at all in a monorepo: one name, one bucket, every request.
 * `pull_request` and `pull_request_title` are what a request carries of its own
 * — its labels and its title — and both travel in the listing already read, so
 * neither costs a call.
 */
export type RuleTarget =
  | 'environment'
  | 'repository'
  | 'incident'
  | 'pull_request'
  | 'pull_request_title';

/**
 * The targets whose subject is a merged pull request, in the order their
 * attributes are merged — first to state a key keeps it.
 *
 * What the request says of itself beats what its repo says: a label is put
 * there deliberately, a title follows a convention, and the repo name is the
 * coarsest of the three — the one that says nothing at all in a monorepo.
 */
export const PULL_REQUEST_TARGETS = [
  'pull_request',
  'pull_request_title',
  'repository',
] as const satisfies readonly RuleTarget[];

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
  /**
   * Attributes the rule forces when its pattern matches, on top of whatever its
   * named groups capture. A group can only ever yield text the name contains;
   * these exist for the names that carry nothing to capture — `ProdContoso`
   * says which customer it serves but never which application. Empty for the
   * rules that only capture.
   */
  attributes: Record<string, string>;
  /**
   * Pattern the repo must match for the rule to contribute anything — groups
   * and forced attributes alike. Strictly: a rule that names a repo stands down
   * wherever the repo is unknown, which is every view that folds a name across
   * repos. Null, the common case, means the rule applies everywhere.
   */
  repo: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Environment addresses ───────────────────────────────────────────

/**
 * Whether a derived address may replace the one the platform published.
 *
 * `fill` is the default and covers the case the feature exists for: neither
 * host states an environment's address unless somebody configured one, so most
 * deployments arrive with nothing to link to. `overwrite` is for the addresses
 * that are published and wrong — an internal hostname, a load balancer nobody
 * outside the cluster can reach.
 */
export type EnvUrlMode = 'fill' | 'overwrite';

/**
 * A rule deriving an environment's address from its name. Defined once for the
 * whole install, like the classification rules, and opted into per source.
 */
export interface EnvUrlRulePublic {
  id: string;
  name: string;
  /** Pattern the environment name must match; its named groups feed the template. */
  pattern: string;
  /** Pattern the repo must match. Null, the common case, means every repo. */
  repo: string | null;
  /**
   * Literal text and placeholders: the pattern's own named groups, plus
   * `{environment}`, `{repo}`, `{ref}` and `{attr.*}` from the classification.
   */
  urlTemplate: string;
  mode: EnvUrlMode;
  /** Lower wins when two rules claim the same environment. */
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * An environment written down by hand, for the ones no source reports —
 * shipped appliances, installs done by hand — and, when the name matches a
 * reported one, the last word on where it answers.
 */
export interface ManualEnvironmentPublic {
  id: string;
  sourceId: string;
  /** Empty when the environment belongs to no repo. */
  repo: string;
  environment: string;
  url: string | null;
  /** Forced attributes: nothing classified it, since no name was matched. */
  attributes: Record<string, string>;
  mode: EnvUrlMode;
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

/** Every metric the report computes — the list a route validates against. */
export const DORA_METRICS = [
  'deployment_frequency',
  'lead_time',
  'change_failure_rate',
  'mttr',
  'coding_time',
  'pickup_time',
  'review_time',
  'deploy_time',
] as const;

export type DoraMetric = (typeof DORA_METRICS)[number];

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

/**
 * Where a reading sits on the scale the DORA report publishes.
 *
 * Ordered worst to best, which is the order the bands are drawn in.
 */
export type DoraTier = 'low' | 'medium' | 'high' | 'elite';

export const DORA_TIERS: readonly DoraTier[] = ['low', 'medium', 'high', 'elite'];

/**
 * Band edges, best-first, in the unit the metric is computed in — seconds for
 * durations, a 0..1 ratio for the failure rate, deployments per day for the
 * frequency, which is what that metric is measured in.
 *
 * Three numbers per metric: below the first is `elite`, below the second
 * `high`, below the third `medium`, and anything else `low`. The frequency
 * reads the other way round — more is better — which `doraTier` handles.
 *
 * The published report is not a clean set of cuts: it leaves a gap between
 * "less than one hour" and "between one day and one week" for lead time, and
 * some years collapse three failure-rate bands into one. The edges here close
 * those gaps upward, which is the reading that does not flatter.
 */
export const DORA_TIER_THRESHOLDS: Record<string, [number, number, number]> = {
  // Per day: daily or better, then weekly, then monthly.
  deployment_frequency: [1, 1 / 7, 1 / 30],
  // One hour, one week, one month.
  lead_time: [3_600, 604_800, 2_592_000],
  // 15 %, 30 %, 45 %.
  change_failure_rate: [0.15, 0.3, 0.45],
  // One hour, one day, one week.
  mttr: [3_600, 86_400, 604_800],
};

/**
 * The band a value falls in, or null for a metric the report says nothing
 * about — the breakdown metrics have no published scale, and inventing one
 * would dress a guess as a standard.
 */
export function doraTier(metric: DoraMetric, value: number): DoraTier | null {
  const edges = DORA_TIER_THRESHOLDS[metric];
  if (!edges) return null;
  // Frequency is the one metric where a bigger number is a better one.
  const better = metric === 'deployment_frequency';
  const beats = (edge: number) => (better ? value >= edge : value < edge);
  if (beats(edges[0])) return 'elite';
  if (beats(edges[1])) return 'high';
  if (beats(edges[2])) return 'medium';
  return 'low';
}

/**
 * Whether readings of this unit are summed when several are folded into one,
 * rather than averaged over the events behind them.
 *
 * A rate adds up over **dimension combinations**, which all cover the same
 * period: two deployments a day to production and three to staging is five a
 * day, where averaging would answer "two and a half" to a question nobody
 * asked. Durations and ratios are the other case.
 *
 * Not over consecutive **periods**, which nothing here does: eight daily rates
 * do not sum to the rate over the week, they average to it.
 *
 * Stated once because three readers need it — the fold behind a filtered
 * value, the fold behind a historised series, and the trend that decides
 * whether a silent slice is a zero — and three answers would eventually differ.
 */
export function addsUp(unit: DoraResult['unit']): boolean {
  return unit === 'per_day';
}

/** A computed DORA metric for one dimension combination. */
export interface DoraResult {
  metric: DoraMetric;
  /** deployments per day for frequency, seconds for durations, 0..1 ratio for CFR. */
  value: number;
  unit: 'per_day' | 'seconds' | 'ratio';
  dimensions: Record<string, string>;
  /** Number of events the value is derived from. */
  sampleSize: number;
  /** Most recent contributing events, capped — sampleSize keeps the real total. */
  samples: DoraSample[];
  /**
   * How many dimension combinations this reading folds together. Absent on a
   * result that is one combination, which is what every producer returns.
   *
   * Worth stating because a fold is where a reading stops being about one
   * thing: a value over three combinations was computed across all their
   * events, while the sample list below shows the most recent of the lot. Being
   * unable to find the value in the visible rows is expected, and a page that
   * does not say so leaves the reader to discover it as a contradiction.
   */
  combinations?: number;
}

/**
 * Lookback windows the UI offers, in days. A month counts as 30 days and a year
 * as 365, so the labels stay round rather than calendar-exact. The API accepts
 * any value in [DORA_WINDOW_MIN, DORA_WINDOW_MAX] — these are what the dropdowns
 * propose, not what the backend enforces.
 */
export const DORA_WINDOW_PRESETS: readonly number[] = [7, 15, 30, 60, 90, 180, 365];

export const DORA_WINDOW_MIN = 1;
/**
 * Widest window accepted — wider than the widest preset, and deliberately.
 *
 * A source can be ingested two years deep, so a range the store actually holds
 * has to stay readable: by an ad-hoc query, and by an install that had two
 * years configured before the dropdowns stopped offering it.
 */
export const DORA_WINDOW_MAX = 730;

/**
 * Depths a stored source offers, in days, and the bounds around them.
 *
 * The reporting windows plus the two years they no longer propose, which is
 * where the long end belongs: a depth shallower than the window would leave the
 * reports reading rows nobody ingested, and one deeper is exactly what makes
 * widening the window later worth anything. A window is what gets read; a depth
 * is what is kept, and keeping more than is read is the point of having both.
 */
export const SOURCE_HISTORY_PRESETS: readonly number[] = [...DORA_WINDOW_PRESETS, 730];
export const SOURCE_HISTORY_MIN = DORA_WINDOW_MIN;
export const SOURCE_HISTORY_MAX = DORA_WINDOW_MAX;

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
/**
 * A listing that gave up before reaching the far end of the period asked for.
 *
 * The bound of a deep read is a date, and what stops it is a page count, so a
 * repository busy enough to fill the window with more rows than the cap allows
 * is read down to wherever the pages ran out. The metrics are then computed
 * over a shorter period than the one on screen — a plausible figure, and a
 * wrong one, which is why this travels with the report rather than staying in
 * a log nobody is reading at the time.
 *
 * A monorepo is where this stops being theoretical: the cap is per repository,
 * so the traffic that ten repos spread over ten budgets now lands in one.
 */
export interface TruncatedRead {
  repo: string;
  /** Which listing ran out of pages. */
  resource: 'deployments' | 'pipelines' | 'merged_pull_requests';
}

export interface DoraReport {
  /**
   * One reading per metric, folded over whatever the filter asked for. Not a
   * page: there are as many entries as there are metrics, and the breakdown
   * the filter narrows is stated by the filter bar rather than repeated on
   * every row.
   */
  results: DoraResult[];
  /** Every repo in the source scope, filter applied or not. */
  repos: string[];
  /** Dimension key → observed values, over the repo-scoped results. */
  dimensions: Record<string, string[]>;
  /**
   * The same vocabulary, per metric — collected before slicing, like the one
   * above.
   *
   * A dimension is an attribute of the events a metric is computed from, and
   * the families are classified by different rules: deployments by the
   * environment ones, merged pull requests by their own. So a key only one
   * family carries slices the other's metrics to nothing, and the union above
   * cannot say which. A metric with no reading at all over the period has no
   * entry, which is not the same thing and reads differently.
   */
  dimensionsByMetric: Partial<Record<DoraMetric, Record<string, string[]>>>;
  /** The period actually used, defaults resolved. */
  period: DoraPeriod;
  /**
   * Listings that did not reach the start of that period. Empty is the normal
   * answer, and an empty array is also what a `stored` source always answers:
   * its depth is its own setting, and what the ingestion managed to reach is
   * not a property of this read.
   */
  truncated: TruncatedRead[];
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
  /** What this account chose for itself; nulls fall back to the settings. */
  display: DisplayPreference;
  /**
   * The language this account reads in. Null follows the browser, which is
   * what an account that never chose should do — a machine set to French is a
   * better guess than the installation's own default.
   */
  language: Language | null;
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
   * Cron pattern of the store's purge.
   *
   * Its own schedule rather than a step of the collection, which is what it
   * used to be: the collection runs every few minutes because freshness asks it
   * to, and nothing about deleting rows older than a source's depth needs to
   * happen that often. Sharing a cadence also meant that widening a depth was
   * raced by a sweep at the old one, minutes later.
   */
  pruneCron: string;
  /**
   * Days kept beyond each source's ingestion depth before a row is swept.
   *
   * The margin is what makes deepening a source read as a decision rather than
   * as data loss: a month asked for the day after a fortnight was configured
   * finds the fortnight still there. Zero sweeps exactly at the depth.
   */
  retentionMarginDays: number;
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
  /**
   * Name of the dimension attribute that designates a **deployable**, or null
   * where nothing designates one — the default, and the historical behaviour.
   *
   * Not a "this repo is a monorepo" flag: there is none, and one would be at
   * the wrong granularity anyway, a source holding a monorepo and a dozen
   * ordinary repos alike. It declares a word, once, for the whole install —
   * `component`, say — and the correlation between a merged request and the
   * deployment that carried it narrows to pairs that agree on it.
   *
   * Which pairs those are is decided by the rules, not by this: where either
   * side does not state the attribute, the correlation falls back to repository
   * and time. So a repo whose rules produce nothing is untouched, and the
   * monorepo beside it is narrowed, with nothing declared per repo.
   *
   * A name is needed rather than comparing every dimension because a request
   * carries attributes a deployment never will — `change=fix` says nothing
   * about where the change landed, and requiring agreement on it would pair
   * nothing with anything.
   */
  componentAttribute: string | null;
  /**
   * How many pages a bounded listing reads before giving up on reaching its
   * bound, per repository and per listing.
   *
   * Calibrated for one repo of ordinary traffic, which is what it was born as.
   * A monorepo holds what would otherwise be a dozen repositories' worth of
   * merges and deployments behind a single one of these budgets, so it is the
   * install that has one which needs to raise this — deliberately, since a
   * higher ceiling on a busy source is a larger bill.
   *
   * Whether it was reached is reported by `DoraReport.truncated`, which is the
   * half of this that matters: guessing a number is only safe when overshooting
   * says so.
   */
  collectionPageCap: number;
  /** Which engine renders the Markdown of a release note. */
  releaseNotesGenerator: ReleaseNotesGenerator;
  /**
   * How the overview presents itself, for everyone who has not chosen
   * otherwise. This is the wall screen's setting as much as the newcomer's.
   */
  overviewDirection: OverviewDirection;
  /** Light or dark for everyone who has not chosen otherwise. */
  displayMode: DisplayMode;
}

/** Bounds of `quotaReservePct`; a reserve of everything would collect nothing. */
export const QUOTA_RESERVE_PCT_MIN = 0;
export const QUOTA_RESERVE_PCT_MAX = 90;

/**
 * Bounds of `collectionPageCap`. One page is a floor rather than zero — a
 * listing that reads nothing is a source that reports nothing — and a hundred
 * is ten thousand rows per repository and per listing, past which the honest
 * answer is a narrower period rather than a deeper read.
 */
export const COLLECTION_PAGE_CAP_MIN = 1;
export const COLLECTION_PAGE_CAP_MAX = 100;

/**
 * Bounds of `retentionMarginDays`.
 *
 * The ceiling is a year because the margin is a grace period, not a second
 * depth: an install that wants to keep two years of history says so on its
 * sources, where the ingestion can actually go and fetch them.
 */
export const RETENTION_MARGIN_MIN = 0;
export const RETENTION_MARGIN_MAX = 365;

// ─── Aggregated dashboard responses ──────────────────────────────────

/**
 * An environment discovered in the deployments of a source, resolved against
 * its rules. An environment no rule matches is still listed, with empty
 * attributes and meta-environments.
 *
 * Every field describes the deployments the caller handed over, so it describes
 * whatever window those covered. The overview folds them over the reported
 * period — an environment nothing reached inside it is therefore not a row at
 * all — while the dashboard folds the most recent slice, which is the present.
 */
export interface DashboardEnvironment {
  name: string;
  /**
   * What the deployments folded into this row say, minus what they contradict
   * each other about — empty when no rule matches any of them. A row can span
   * several repos, and one environment name can mean different things in two of
   * them: a key they answer *differently* is dropped rather than picked between,
   * since a row claiming either would be true of neither. A key only one of them
   * answers is kept — silence is not disagreement. Narrow the set (by filtering
   * on a dimension) and the row says more, because less is left to contradict it.
   */
  attributes: Record<string, string>;
  /** Every membership the row's deployments carry — a set contradicts nothing. */
  metaEnvironments: string[];
  /** Repos having deployed to this environment over the window. Empty on a
   * declared environment, which may belong to no repo and has deployed nothing
   * either way. */
  repos: string[];
  deployments: number;
  /**
   * Null on an environment nothing deployed to over the window — which only a
   * declared one can be. A row exists for it because somebody wrote it down,
   * and the three fields below describe deployments it never had.
   */
  lastDeployAt: string | null;
  lastStatus: PipelineStatus | null;
  /**
   * The ref the **last deployment of the set** carried. Folded over the present
   * that is what is running there right now — "which version is live for that
   * client" is the question an environment is looked up for, and the date alone
   * never answered it. Folded over a period that ended, it is what was running
   * at the end of it, which is a different sentence and the honest one there.
   */
  ref: string | null;
  /**
   * Whether the row exists because somebody declared the environment rather
   * than because something deployed to it. Both are real environments; only one
   * of them can be expected to have a deployment history.
   */
  declared: boolean;
  /**
   * Statuses of the most recent deployments, oldest first and capped at
   * ENVIRONMENT_RECENT_MAX. Read as a whole rather than one by one: a run of
   * failures and an isolated one are the same `lastStatus`, and not the same
   * situation at all.
   */
  recent: PipelineStatus[];
}

/** How many deployments an environment reports the outcome of. */
export const ENVIRONMENT_RECENT_MAX = 11;

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

// ─── Overview ────────────────────────────────────────────────────────

/**
 * A metric as the overview reads it: the value, where it is going, and whether
 * that direction is good news. `improving` is not derivable from the sign of
 * `delta` — a rising deployment frequency is progress, a rising restore time
 * is not — and the front should not have to hold that table.
 */
export interface OverviewFlow {
  metric: DoraMetric;
  /** deployments per day for frequency, seconds for durations, 0..1 ratio for CFR. */
  value: number;
  unit: 'per_day' | 'seconds' | 'ratio';
  sampleSize: number;
  /** Bucketed history behind the sparkline, oldest first. Empty until snapshots exist. */
  trend: number[];
  /**
   * Change against the window immediately before this one, as a signed ratio.
   * Null when that window holds nothing to compare against — a young install
   * has no past, which is not the same as no change.
   */
  delta: number | null;
  /** Null exactly when `delta` is. */
  improving: boolean | null;
}

/** What is in the way right now, as counted over the filtered scope. */
export interface OverviewFriction {
  openPrs: number;
  stalePrs: number;
  failedPipelines: number;
  runningPipelines: number;
  /** Median time from opening to merge, in seconds; null when nothing merged. */
  reviewTimeSec: number | null;
}

/** Whether what the page shows can be trusted, and for how long it has been so. */
export interface OverviewHealth {
  mode: SourceMode;
  syncedAt: string | null;
  /** Age of the stored view in seconds; null in live mode, where there is none. */
  staleForSec: number | null;
  /**
   * `unreachable` is the one worth watching: the API keeps serving stored data
   * while nothing at all is being collected behind it.
   *
   * Null for a caller without an account. How the collection is doing is
   * operational detail, and the background-jobs section is kept to the admins
   * for the same reason — an overview that may be public must not be the way
   * around that.
   */
  queues: 'ok' | 'degraded' | 'unreachable' | null;
  /**
   * Share of the API budget still available, 0..1. Null when nothing was
   * observed, and null for a caller without an account — see `queues`.
   */
  quotaLeft: number | null;
}

/**
 * A deployment on the recent-activity window the overview reads — the journal
 * covers all of it, the control room's frieze the last day of it.
 *
 * Deliberately not the reporting period: this is what has just happened, and
 * the two questions are different ones. What reports over the period reads the
 * deployments route.
 */
export interface OverviewEvent {
  /** The provider's own identity — two deployments of one environment in the
   * same second are two events, and a key built from the pair made them one. */
  id: string;
  at: string;
  environment: string;
  repo: string;
  ref: string;
  status: PipelineStatus;
  /**
   * Where the deployment is read on the platform, when one publishes a page
   * for it. Null is ordinary — see `Deployment.url`.
   */
  url: string | null;
  /** The environment's attributes, so a lane can be drawn per dimension. */
  attributes: Record<string, string>;
}

/**
 * What the overview reads in one call.
 *
 * The environments come back flat and unpaginated: the page groups and pivots
 * them on whichever dimension the reader picked, and a window would cut the
 * pivot in half. The vocabularies are computed **before** filtering, like
 * `DeploymentReport` does — narrowing one dimension must never empty the list
 * the next one is picked from.
 */
export interface OverviewReport {
  sourceId: string;
  /**
   * The environments **of the period**: a row is a report over the window, so
   * its count and its heartbeat describe it and one nothing reached inside it
   * is not a row at all. What the board reads.
   */
  environments: DashboardEnvironment[];
  /**
   * The environments **as they stand**, whatever the period — what is live for
   * each client right now. Read by the matrix, whose whole job is to reveal a
   * version that has *not* moved: narrowing that to the period would hide
   * precisely the rows it is looked at for.
   */
  running: DashboardEnvironment[];
  /** Dimension key → observed values, over the whole scope. */
  dimensions: Record<string, string[]>;
  metaEnvironments: string[];
  repos: string[];
  flow: OverviewFlow[];
  friction: OverviewFriction;
  health: OverviewHealth;
  /** Deployments of the last 24 hours, most recent first. */
  events: OverviewEvent[];
  /**
   * What every environment was last read running — the same readings the
   * deployments page shows, not a second gathering.
   *
   * **Empty for a caller without an account**, like `health.queues` and
   * `health.quotaLeft`: a version states which release is exposed on which
   * public environment, which is operational detail rather than the delivery
   * summary an anonymous visitor is shown. Never narrowed by the period —
   * an environment nobody has deployed to for a month is still running
   * something, and a grid that hid it would hide the row most worth seeing.
   */
  versions: EnvironmentVersion[];
  period: DoraPeriod;
  /** Non-blocking errors collected while assembling the above. */
  warnings: CodedMessage[];
}

// ─── Presentation ────────────────────────────────────────────────────

/**
 * How the overview presents itself. One name per direction rather than a
 * theme/layout pair: `stream` is a different composition, not a repaint of
 * `control`, and naming it as a third direction keeps the setting readable by
 * the person choosing it.
 */
export type OverviewDirection = 'control' | 'instrument' | 'stream' | 'versions';

export const OVERVIEW_DIRECTIONS: readonly OverviewDirection[] = [
  'control',
  'instrument',
  'stream',
  'versions',
];

/**
 * `system` is a state of its own, not the absence of a choice: it hands the
 * decision to the operating system and keeps following it as that changes.
 */
export type DisplayMode = 'system' | 'light' | 'dark';

export const DISPLAY_MODES: readonly DisplayMode[] = ['system', 'light', 'dark'];

/**
 * What a reader has chosen for themselves. Null means "whatever the install
 * says" — kept apart from a value so that changing the installation default
 * still moves everyone who never expressed a preference.
 */
export interface DisplayPreference {
  direction: OverviewDirection | null;
  mode: DisplayMode | null;
}

// ─── Background jobs ─────────────────────────────────────────────────

/**
 * The queues the install runs. `collection` carries the scheduled
 * synchronisation and the per-source work it fans out; `ingest` carries what
 * webhook deliveries ask to be written; `versions` carries the readings an
 * event asks for, which wait out a settling delay and then call somebody
 * else's application.
 *
 * Three rather than one because each has a different pace and a different
 * appetite: a burst of events must not wait behind a synchronisation that takes
 * minutes, and a reading that sleeps thirty seconds before it starts must not
 * hold an ingestion worker while it does.
 */
export const QUEUE_NAMES = ['collection', 'ingest', 'versions'] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** BullMQ's own states, as the background-jobs page reads them. */
export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * A job the scheduler re-registers rather than one somebody enqueued. Only the
 * collection has one, on the cron of the settings.
 */
export interface RepeatableJobPublic {
  name: string;
  /** Cron pattern it repeats on. */
  pattern: string;
  /** ISO date of the next occurrence; null when BullMQ states none. */
  nextRunAt: string | null;
}

export interface QueueSummary {
  name: QueueName;
  counts: QueueCounts;
  repeatables: RepeatableJobPublic[];
  paused: boolean;
}

/**
 * What the background-jobs page reads in one call.
 *
 * `observedAt` is stamped by the API because none of this is stored: the counts
 * are a reading of the instant, and a page that polls has to be able to say how
 * old the one it is showing is.
 */
export interface JobsSnapshot {
  queues: QueueSummary[];
  observedAt: string;
  /**
   * Null when Redis answered, the coded reason when it did not. This is the
   * one state worth watching for: the API keeps serving stored data while
   * nothing at all is being collected behind it.
   */
  unreachable: CodedMessage | null;
}

/**
 * A job that exhausted its attempts.
 *
 * `data` travels with it — a source id, an ingestion intent — so a failure can
 * be read for what it was working on without going back to the container logs.
 */
export interface JobFailure {
  queue: QueueName;
  id: string;
  /** Job name within its queue: `collect-source`, `ingest-event`… */
  name: string;
  attemptsMade: number;
  /** What BullMQ recorded of the last throw. */
  reason: string;
  /** The last stack trace, when there is one. */
  stack: string | null;
  /** ISO date the last attempt ended; null while BullMQ states none. */
  failedAt: string | null;
  /** ISO date the job was enqueued. */
  enqueuedAt: string;
  data: Record<string, unknown>;
}

/**
 * A job in flight: running, or queued behind one that is.
 *
 * The counts alone answer "three things are happening" and nothing else, which
 * is unreadable exactly when it matters — a queue that is not draining looks
 * the same as one that is. This carries what each job is working on and how
 * long it has been at it.
 */
export interface JobRunning {
  queue: QueueName;
  id: string;
  name: string;
  /** `active` is running; `waiting` and `delayed` are lined up behind it. */
  state: Extract<JobState, 'active' | 'waiting' | 'delayed'>;
  /** ISO date the worker picked it up; null for one that has not started. */
  startedAt: string | null;
  /** ISO date it was enqueued — how long a waiting job has been waiting. */
  enqueuedAt: string;
  /** ISO date a delayed job is due to run; null when it is not delayed. */
  scheduledFor: string | null;
  /** 0-100 where the job reports it, null where it reports nothing. */
  progress: number | null;
  /** Which attempt is in flight: above 1, this one already failed once. */
  attemptsMade: number;
  data: Record<string, unknown>;
}

/**
 * A job that completed, having given up on part of its work.
 *
 * The counterpart of `JobFailure`, and the reason the page shows more than a
 * queue state: a collection catches its best-effort steps so a snapshot is
 * still written, which completes the job green over a source that has stopped
 * moving. Nothing failed, so nothing is to be retried — the next run will try
 * again on its own. It is there to be read.
 */
export interface JobWarning {
  queue: QueueName;
  id: string;
  name: string;
  /** ISO date the run ended; null while BullMQ states none. */
  finishedAt: string | null;
  data: Record<string, unknown>;
  warnings: CodedMessage[];
}

/**
 * How many jobs are read back per queue and per state before the lists are
 * merged and windowed. The counts in the summary state how many there really
 * are, and this never caps them — it bounds what one page load pulls out of
 * Redis, nothing else.
 */
export const JOB_SCAN_DEPTH = 200;

/**
 * Where a job is in its life, as a caller following one needs it.
 *
 * `unknown` is what BullMQ answers for a job it can no longer place — one
 * evicted by the queue's own history bounds, typically. A page holding an id
 * from an hour ago has to be able to tell that apart from a failure.
 */
export const JOB_STATES = [
  'waiting',
  'active',
  'delayed',
  'completed',
  'failed',
  'unknown',
] as const;
export type JobState = (typeof JOB_STATES)[number];

/** Terminal states: nothing more will happen to a job in one of these. */
export function isJobSettled(state: JobState): boolean {
  return state === 'completed' || state === 'failed' || state === 'unknown';
}

/** What enqueueing returns: enough to come back and ask how it went. */
export interface JobHandle {
  queue: QueueName;
  id: string;
}

/**
 * One job, followed.
 *
 * Deliberately thinner than `JobFailure`: this is read by whoever started the
 * work from the sources page, not by an admin reading the queues, so it carries
 * how it went and no payload.
 */
export interface JobStatus extends JobHandle {
  name: string;
  state: JobState;
  /** 0-100 where the job reports it, null where it reports nothing. */
  progress: number | null;
  /** Coded reason it failed, or null. */
  error: CodedMessage | null;
  /** What a completed collection gave up on — the degraded case, per source. */
  warnings: CodedMessage[];
  /** ISO date the run ended; null while it has not. */
  finishedAt: string | null;
}
