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

  listPullRequests(ctx: ConnectorContext, repos: string[]): Promise<PullRequest[]>;

  listPipelines(ctx: ConnectorContext, repos: string[]): Promise<Pipeline[]>;

  listDeployments(ctx: ConnectorContext, repos: string[]): Promise<Deployment[]>;

  /** Merged PRs/MRs updated since the given ISO date (for lead time). */
  listMergedPullRequests(
    ctx: ConnectorContext,
    repos: string[],
    since: string,
  ): Promise<MergedPullRequest[]>;

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
}

/** A request as an association answers it: what to link, and what to extract from. */
export interface CommitPullRequest {
  number: number;
  url: string;
  /** Source branch — where the ticket references usually are. */
  headRef: string;
}
