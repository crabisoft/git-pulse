import type {
  Deployment,
  MergedPullRequest,
  Pipeline,
  PullRequest,
  ScopeRules,
  SourceMode,
} from '@repo/shared';

/**
 * Where a source's data comes from, on the read side.
 *
 * Exactly the subset of `SourceConnector` the dashboard and DORA consume, minus
 * the connection context they had to thread through every call. Two
 * implementations answer it — the provider in the moment, and the store the
 * ingestion fills — and neither caller can tell which one it holds. That is the
 * whole of what the mode does.
 *
 * The release notes are deliberately absent: they read tags and commits, which
 * are not stored, so they stay live in either mode.
 */
export interface SourceReader {
  listRepositories(): Promise<string[]>;
  listPullRequests(repos: string[]): Promise<PullRequest[]>;
  listPipelines(repos: string[]): Promise<Pipeline[]>;
  listDeployments(repos: string[]): Promise<Deployment[]>;
  /** Merges since the given ISO date — the basis of every lead time. */
  listMergedPullRequests(repos: string[], since: string): Promise<MergedPullRequest[]>;
  /**
   * When this view was last brought up to date. Null reading live, where the
   * question does not arise, and null on a store nothing has filled yet.
   */
  freshness(): Promise<Date | null>;
  /** The scope the source tracks — what ticket extraction is keyed on. */
  readonly scope: ScopeRules;
  /** Which of the two this is. Reported to the client, never branched on here. */
  readonly mode: SourceMode;
}
