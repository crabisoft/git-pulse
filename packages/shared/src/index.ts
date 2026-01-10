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
 * The platforms record nothing about which branch a branch was cut from, so
 * `default` is as close to a fork point as anything can honestly get.
 */
export type DeploymentBase = 'previous' | 'default' | 'ref';

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

/**
 * Where a reading sits on the scale the DORA report publishes.
 *
 * Ordered worst to best, which is the order the bands are drawn in.
 */
export type DoraTier = 'low' | 'medium' | 'high' | 'elite';

export const DORA_TIERS: readonly DoraTier[] = ['low', 'medium', 'high', 'elite'];

/**
 * Band edges, best-first, in the unit the metric is computed in — seconds for
 * durations, a 0..1 ratio for the failure rate, deployments **per day** for the
 * frequency (the metric counts them over a window, so the window length has to
 * be divided out before this is read).
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
  /** What this account chose for itself; nulls fall back to the settings. */
  display: DisplayPreference;
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
  /**
   * The ref the last deployment carried — what is running there right now.
   * "Which version is live for that client" is the question an environment is
   * looked up for, and the date alone never answered it.
   */
  ref: string;
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
  /** count for frequency, seconds for durations, 0..1 ratio for CFR. */
  value: number;
  unit: 'count' | 'seconds' | 'ratio';
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

/** A deployment on the shared 24-hour axis. */
export interface OverviewEvent {
  at: string;
  environment: string;
  repo: string;
  ref: string;
  status: PipelineStatus;
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
  environments: DashboardEnvironment[];
  /** Dimension key → observed values, over the whole scope. */
  dimensions: Record<string, string[]>;
  metaEnvironments: string[];
  repos: string[];
  flow: OverviewFlow[];
  friction: OverviewFriction;
  health: OverviewHealth;
  /** Deployments of the last 24 hours, most recent first. */
  events: OverviewEvent[];
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
export type OverviewDirection = 'control' | 'instrument' | 'stream';

export const OVERVIEW_DIRECTIONS: readonly OverviewDirection[] = [
  'control',
  'instrument',
  'stream',
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
 * webhook deliveries ask to be written. Two rather than one so a burst of
 * events never waits behind a synchronisation that takes minutes.
 */
export const QUEUE_NAMES = ['collection', 'ingest'] as const;

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
