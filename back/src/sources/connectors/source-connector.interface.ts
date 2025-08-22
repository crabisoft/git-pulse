import type {
  PullRequest,
  Pipeline,
  Deployment,
  MergedPullRequest,
  ScopeRules,
  ConnectionTestResult,
} from '@repo/shared';

/** Decrypted source credentials, discriminated by auth kind. */
export type SourceAuth =
  | { kind: 'token'; token: string }
  | { kind: 'app'; appId: string; privateKey: string; installationId: string };

/** Resolved connection context (decrypted credentials) handed to a connector. */
export interface ConnectorContext {
  baseUrl: string;
  auth: SourceAuth;
  scope: ScopeRules;
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
}
