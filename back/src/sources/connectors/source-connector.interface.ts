import type {
  PullRequest,
  Pipeline,
  Deployment,
  ScopeRules,
  ConnectionTestResult,
} from '@repo/shared';

/** Resolved connection context (decrypted secret) handed to a connector. */
export interface ConnectorContext {
  baseUrl: string;
  /** Plaintext access secret (token, or App installation token). */
  token: string;
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
}
