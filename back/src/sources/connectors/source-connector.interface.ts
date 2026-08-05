import type {
  Commit,
  PullRequest,
  Pipeline,
  Deployment,
  MergedPullRequest,
  ScopeRules,
  ConnectionTestResult,
  RepositoryRef,
  Tag,
  Branch,
  TruncatedRead,
} from '@repo/shared';
import type { QuotaSink } from '../../api-quota/rate-limit-headers';

/** Decrypted source credentials, discriminated by auth kind. */
export type SourceAuth =
  | { kind: 'token'; token: string }
  | { kind: 'app'; appId: string; privateKey: string; installationId: string };

/** Resolved connection context (decrypted credentials) handed to a connector. */
export interface ConnectorContext {
  baseUrl: string;
  auth: SourceAuth;
  scope: ScopeRules;
  /**
   * Cancels the collection when the caller gives up — a client that closed its
   * connection, typically. It travels in the context rather than in every
   * signature because the context already reaches every method here.
   *
   * A connector honours it two ways: by handing it to its HTTP client when that
   * one accepts it, and by checking it between repos. The second matters most:
   * the cost is the fan-out, not any single call. Absent for the scheduled
   * collection, which nobody is waiting on.
   */
  signal?: AbortSignal;
  /**
   * Where the rate-limit headers of each response are reported. It travels in
   * the context for the same reason as the signal, and it is bound to the
   * subject being billed — so a connector reports what it read without having
   * to know whose budget it charges.
   *
   * Absent when nobody is metering, which keeps the connectors usable outside
   * a Nest context.
   */
  onQuota?: QuotaSink;
  /**
   * Whether the **optional** calls may still be made — the enrichment that
   * costs one or two calls per pull request and per deployment, where listing
   * them costs one per repo. That fan-out is what empties a budget, and it is
   * also what can be given up without losing a metric outright: a lead time
   * without its segments, a deployment whose status is unknown.
   *
   * Asked once per item rather than once per run: the budget drains as the run
   * goes, and the point is to stop before the ceiling, not to have decided
   * beforehand. Absent means yes — a connector run outside a Nest context, or
   * an install whose consumption nobody knows, attempts everything.
   */
  allowsOptionalCalls?: () => boolean;
  /**
   * How many pages a bounded listing may read before giving up on reaching its
   * bound. Absent means the connector's own default — a connector run outside
   * a Nest context has no settings to read.
   */
  maxPages?: number;
  /**
   * Where a listing says it ran out of pages before reaching the date it was
   * bounded by. It travels here for the same reason the quota sink does: the
   * connector states what it observed, and the caller decides whether anybody
   * is told.
   *
   * Absent when nobody is collecting, which is every caller that only logs.
   */
  onTruncated?: (read: TruncatedRead) => void;
}

/** A commit a ref points at, or the one two refs last had in common. */
export interface RefCommit {
  sha: string;
  /** Null on a platform that answered the commit without dating it. */
  committedAt: string | null;
}

/**
 * Common contract for every source. Each platform (GitHub, GitLab, …) provides
 * an implementation that normalizes its data into the shared types. Adding a
 * platform means adding an implementation — nothing else changes.
 */
export interface SourceConnector {
  readonly kind: string;

  testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult>;

  /** Repos/projects in scope, after include/exclude is applied. */
  listRepositories(ctx: ConnectorContext): Promise<string[]>;

  /**
   * Every repo the owner exposes, with how it is exposed, before the scope is
   * applied — what a selection is picked from. The scoped listing above is this
   * one filtered, so the two can never offer a repo the other refuses.
   */
  listAllRepositories(ctx: ConnectorContext): Promise<RepositoryRef[]>;

  listPullRequests(ctx: ConnectorContext, repos: string[]): Promise<SourcePullRequest[]>;

  /**
   * Pipelines/runs of these repos, newest first.
   *
   * `since` is an ISO date the listing reads back down to, and omitting it asks
   * for the most recent page only. The two callers want opposite things and
   * both are right: a live read shows what is happening now and pays for one
   * page per repo, while an ingestion fills a window it will be reporting over
   * and has to reach the far end of it.
   */
  listPipelines(ctx: ConnectorContext, repos: string[], since?: string): Promise<Pipeline[]>;

  /** Deployments of these repos, newest first — same `since` rule as above. */
  listDeployments(ctx: ConnectorContext, repos: string[], since?: string): Promise<Deployment[]>;

  /** Merged PRs/MRs updated since the given ISO date (for lead time). */
  listMergedPullRequests(
    ctx: ConnectorContext,
    repos: string[],
    since: string,
  ): Promise<SourceMergedPullRequest[]>;

  /** Tags of a repo, most recent first — what a release range is picked from. */
  listTags(ctx: ConnectorContext, repo: string): Promise<Tag[]>;

  /**
   * Branches of a repo. A range bound may be one: the compare endpoints take a
   * ref, so a tag and a branch cost the same and read differently.
   */
  listBranches(ctx: ConnectorContext, repo: string): Promise<Branch[]>;

  /**
   * Commits reachable from `to` but not from `from`. An omitted `from` means
   * the whole history up to `to`, which is what a first release needs.
   */
  listCommitsBetween(
    ctx: ConnectorContext,
    repo: string,
    from: string | null,
    to: string,
  ): Promise<Commit[]>;

  /** The branch a repo defaults to, when no range bound is given. */
  defaultBranch(ctx: ConnectorContext, repo: string): Promise<string>;

  /**
   * The commit a ref points at. Null when the platform will not resolve it,
   * which is the ordinary fate of a deployed branch that has been deleted.
   */
  refCommit(ctx: ConnectorContext, repo: string, ref: string): Promise<RefCommit | null>;

  /**
   * The last commit two refs have in common, with the date it was made.
   *
   * The date is the whole point: comparing two candidates asks which of them
   * parted from a ref most recently, and only a date answers that — a sha
   * orders nothing. Null when the platform will not resolve one of the two,
   * which is an answer here rather than a failure: a candidate that cannot be
   * compared is simply not the nearest one.
   */
  mergeBase(
    ctx: ConnectorContext,
    repo: string,
    ref: string,
    other: string,
  ): Promise<RefCommit | null>;

  /**
   * The pull/merge request each of these commits came in on, keyed by sha. A
   * sha no request claims is simply absent, and so is one whose lookup was
   * given up or failed — an unknown request reads the same either way, which is
   * the only honest thing it can mean.
   *
   * **Optional work, and the expensive kind**: neither platform answers this in
   * bulk, so it is one call per commit. Callers hand it only the shas whose
   * merge commit told them nothing, and it stops as soon as
   * `allowsOptionalCalls` says the budget is spent — a release note without its
   * request links is worth far less than the calls that carry the metrics.
   */
  commitPullRequests(
    ctx: ConnectorContext,
    repo: string,
    shas: string[],
  ): Promise<Map<string, CommitPullRequest>>;

  /**
   * The commits each request was made of, by request number.
   *
   * What a squashed history has instead of the commits themselves: squashing
   * replaces a branch with a single commit, so the work that went into it is
   * nowhere in the range a release note walks — it survives only on the request,
   * which both platforms keep answering for long after the branch is deleted.
   *
   * One call per request, so the same rule as the association above: callers
   * hand it only the requests worth expanding, and it stops as soon as
   * `allowsOptionalCalls` says the budget is spent. A request it gives up on is
   * simply absent from the map, and the caller keeps the commit it had.
   */
  pullRequestCommits(
    ctx: ConnectorContext,
    repo: string,
    numbers: number[],
  ): Promise<Map<number, Commit[]>>;
}

/** A request as an association answers it: what to link, and what to extract from. */
/**
 * A pull request as a source answers it, description included.
 *
 * The description is carried on this type rather than on `PullRequest` because
 * it is read, not displayed: the ticket rules that declare `body` match against
 * it, and then it is dropped. Putting it on the shared type would have put
 * every description of every open pull request on the wire, for a page that
 * shows none of them.
 */
export interface SourcePullRequest extends PullRequest {
  /** Empty when the platform reports none, which is a description of nothing. */
  body: string;
  /**
   * Labels, carried here for the same reason as the description: both feeds
   * read them off the listing they already page through, and the open board
   * displays none of them. Writing them from this feed too is what stops a
   * synchronisation of open requests from blanking what the merged one wrote.
   */
  labels: string[];
}

/**
 * A merged pull request as a source answers it, description included. Carried
 * apart from the shared type for the same reason `SourcePullRequest` is: the
 * description feeds the ticket rules and goes no further.
 */
export interface SourceMergedPullRequest extends MergedPullRequest {
  /** Empty when the platform reports none, which is a description of nothing. */
  body: string;
}

export interface CommitPullRequest {
  number: number;
  url: string;
  /** Source branch — where the ticket references usually are. */
  headRef: string;
  /** The request's own title, which a squash copies and a merge does not. */
  title: string;
  /** Its description — the other place a team writes what it closes. */
  body: string;
}
