import type {
  Commit,
  PullRequest,
  Pipeline,
  Deployment,
  MergedPullRequest,
  ScopeRules,
  ConnectionTestResult,
  Tag,
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
}
