import { Injectable, Logger } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import type {
  Commit,
  PullRequest,
  Pipeline,
  Deployment,
  MergedPullRequest,
  PipelineStatus,
  ConnectionTestResult,
  Tag,
} from '@repo/shared';
import type { ConnectorContext, SourceConnector } from './source-connector.interface';
import { applyScope, ageHours } from './scope.util';

/** GitHub connector — github.com or GitHub Enterprise via baseUrl. */
@Injectable()
export class GitHubConnector implements SourceConnector {
  readonly kind = 'github';
  private readonly logger = new Logger(GitHubConnector.name);

  private client(ctx: ConnectorContext): Octokit {
    return octokitFor(ctx);
  }

  /** Web URL of a repository (github.com or GHE). */
  private repoUrl(ctx: ConnectorContext, repo: string): string {
    const isDotCom = /(^|\/\/)(www\.)?github\.com/.test(ctx.baseUrl);
    const root = isDotCom ? 'https://github.com' : ctx.baseUrl.replace(/\/$/, '');
    return `${root}/${ctx.scope.owner}/${repo}`;
  }

  async testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult> {
    try {
      const gh = this.client(ctx);
      // Works for both token and installation auth, and validates scope access.
      await gh.rest.repos.listForOrg({ org: ctx.scope.owner, per_page: 1 });
      return { ok: true, message: { code: 'sources.test.ok', params: { owner: ctx.scope.owner } } };
    } catch (e) {
      return { ok: false, message: { code: 'sources.test.failed', params: { error: asMessage(e) } } };
    }
  }

  async listRepositories(ctx: ConnectorContext): Promise<string[]> {
    const gh = this.client(ctx);
    const repos = await gh.paginate(gh.rest.repos.listForOrg, {
      org: ctx.scope.owner,
      per_page: 100,
      type: 'all',
    });
    return applyScope(
      repos.map((r) => r.name),
      ctx.scope,
    );
  }

  async listPullRequests(ctx: ConnectorContext, repos: string[]): Promise<PullRequest[]> {
    const gh = this.client(ctx);
    const out: PullRequest[] = [];
    for (const repo of repos) {
      ctx.signal?.throwIfAborted();
      const prs = await gh.paginate(gh.rest.pulls.list, {
        owner: ctx.scope.owner,
        repo,
        state: 'open',
        per_page: 100,
      });
      for (const pr of prs) {
        out.push({
          id: `gh:${repo}:${pr.number}`,
          number: pr.number,
          title: pr.title,
          state: pr.draft ? 'draft' : 'open',
          author: pr.user?.login ?? 'unknown',
          repo,
          repoUrl: this.repoUrl(ctx, repo),
          url: pr.html_url,
          headRef: pr.head.ref,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          mergedAt: pr.merged_at ?? null,
          reviewers: pr.requested_reviewers?.length ?? 0,
          ageHours: ageHours(pr.created_at),
          // Filled by the service, which owns the rules.
          tickets: [],
        });
      }
    }
    return out;
  }

  async listPipelines(ctx: ConnectorContext, repos: string[]): Promise<Pipeline[]> {
    const gh = this.client(ctx);
    const out: Pipeline[] = [];
    for (const repo of repos) {
      ctx.signal?.throwIfAborted();
      const runs = await gh.rest.actions.listWorkflowRunsForRepo({
        owner: ctx.scope.owner,
        repo,
        per_page: 20,
      });
      for (const run of runs.data.workflow_runs) {
        const created = run.created_at;
        const updated = run.updated_at;
        out.push({
          id: `gh:${repo}:${run.id}`,
          repo,
          repoUrl: this.repoUrl(ctx, repo),
          ref: run.head_branch ?? run.head_sha.slice(0, 7),
          status: mapGitHubStatus(run.status, run.conclusion),
          url: run.html_url,
          createdAt: created,
          updatedAt: updated,
          durationSec:
            run.status === 'completed'
              ? Math.round((new Date(updated).getTime() - new Date(created).getTime()) / 1000)
              : null,
        });
      }
    }
    return out;
  }

  async listDeployments(ctx: ConnectorContext, repos: string[]): Promise<Deployment[]> {
    const gh = this.client(ctx);
    const out: Deployment[] = [];
    for (const repo of repos) {
      ctx.signal?.throwIfAborted();
      const deps = await gh.rest.repos.listDeployments({
        owner: ctx.scope.owner,
        repo,
        per_page: 30,
      });
      for (const d of deps.data) {
        // One status call per deployment, and the helper below swallows errors:
        // without this check a cancelled run would keep polling to no end.
        ctx.signal?.throwIfAborted();
        out.push({
          id: `gh:${repo}:${d.id}`,
          repo,
          environment: d.environment,
          ref: d.ref,
          status: await this.deploymentStatus(gh, ctx.scope.owner, repo, d.id),
          createdAt: d.created_at,
        });
      }
    }
    return out;
  }

  async listMergedPullRequests(
    ctx: ConnectorContext,
    repos: string[],
    since: string,
  ): Promise<MergedPullRequest[]> {
    const gh = this.client(ctx);
    const sinceMs = new Date(since).getTime();
    const out: MergedPullRequest[] = [];
    for (const repo of repos) {
      ctx.signal?.throwIfAborted();
      const prs = await gh.rest.pulls.list({
        owner: ctx.scope.owner,
        repo,
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: 50,
      });
      for (const pr of prs.data) {
        if (!pr.merged_at || new Date(pr.merged_at).getTime() < sinceMs) continue;
        // Two extra calls per PR: worth checking inside this loop too.
        ctx.signal?.throwIfAborted();
        const [firstCommitAt, firstReviewAt] = await Promise.all([
          this.firstCommitAt(gh, ctx.scope.owner, repo, pr.number),
          this.firstReviewAt(gh, ctx.scope.owner, repo, pr.number),
        ]);
        out.push({
          id: `gh:${repo}:${pr.number}`,
          repo,
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          headRef: pr.head.ref,
          openedAt: pr.created_at,
          firstCommitAt,
          firstReviewAt,
          mergedAt: pr.merged_at,
        });
      }
    }
    return out;
  }

  async listTags(ctx: ConnectorContext, repo: string): Promise<Tag[]> {
    const gh = this.client(ctx);
    const tags = await gh.rest.repos.listTags({ owner: ctx.scope.owner, repo, per_page: 100 });
    return tags.data.map((tag) => ({
      name: tag.name,
      sha: tag.commit.sha,
      // Lightweight tags carry no date; the commit's stands in when needed.
      taggedAt: null,
    }));
  }

  async listCommitsBetween(
    ctx: ConnectorContext,
    repo: string,
    from: string | null,
    to: string,
  ): Promise<Commit[]> {
    const gh = this.client(ctx);
    const owner = ctx.scope.owner;

    // With both bounds the compare endpoint answers in one call and knows what
    // "reachable from one but not the other" means; without a lower bound there
    // is nothing to compare against, so the log is walked instead.
    if (from) {
      const diff = await gh.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${from}...${to}`,
      });
      return diff.data.commits.map((c) => toCommit(c, repo));
    }
    const log = await gh.paginate(gh.rest.repos.listCommits, {
      owner,
      repo,
      sha: to,
      per_page: 100,
    });
    return log.map((c) => toCommit(c, repo));
  }

  async defaultBranch(ctx: ConnectorContext, repo: string): Promise<string> {
    const gh = this.client(ctx);
    const info = await gh.rest.repos.get({ owner: ctx.scope.owner, repo });
    return info.data.default_branch;
  }

  private async deploymentStatus(
    gh: Octokit,
    owner: string,
    repo: string,
    deploymentId: number,
  ): Promise<PipelineStatus> {
    try {
      const statuses = await gh.rest.repos.listDeploymentStatuses({
        owner,
        repo,
        deployment_id: deploymentId,
        per_page: 1,
      });
      switch (statuses.data[0]?.state) {
        case 'success':
          return 'success';
        case 'failure':
        case 'error':
          return 'failed';
        case 'in_progress':
          return 'running';
        case 'queued':
        case 'pending':
          return 'pending';
        default:
          return 'unknown';
      }
    } catch {
      return 'unknown';
    }
  }

  private async firstCommitAt(
    gh: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string | null> {
    try {
      const commits = await gh.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 1,
      });
      const commit = commits.data[0]?.commit;
      return commit?.author?.date ?? commit?.committer?.date ?? null;
    } catch {
      return null;
    }
  }

  private async firstReviewAt(
    gh: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string | null> {
    try {
      const reviews = await gh.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 1,
      });
      return reviews.data[0]?.submitted_at ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Octokit for a source context — shared with the incident provider, which talks
 * to the same API with the same credentials.
 */
export function octokitFor(ctx: ConnectorContext): Octokit {
  // GHE serves the API under /api/v3; github.com uses api.github.com.
  const isDotCom = /(^|\/\/)(www\.)?github\.com/.test(ctx.baseUrl);
  const baseUrl = isDotCom
    ? 'https://api.github.com'
    : `${ctx.baseUrl.replace(/\/$/, '')}/api/v3`;

  // Set on the client rather than per call: it then reaches every request the
  // instance makes, `paginate` included.
  const request = { signal: ctx.signal };

  if (ctx.auth.kind === 'app') {
    // GitHub App: Octokit mints and caches installation tokens on demand.
    const { appId, privateKey, installationId } = ctx.auth;
    return new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey, installationId },
      baseUrl,
      request,
    });
  }
  return new Octokit({ auth: ctx.auth.token, baseUrl, request });
}

function toCommit(
  c: {
    sha: string;
    html_url: string;
    commit: { message: string; author?: { name?: string | null; date?: string | null } | null };
    author?: { login?: string } | null;
  },
  _repo: string,
): Commit {
  return {
    sha: c.sha,
    message: c.commit.message,
    author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
    authoredAt: c.commit.author?.date ?? new Date(0).toISOString(),
    url: c.html_url,
  };
}

function mapGitHubStatus(status: string | null, conclusion: string | null): PipelineStatus {
  if (status !== 'completed') {
    return status === 'in_progress' ? 'running' : 'pending';
  }
  switch (conclusion) {
    case 'success':
      return 'success';
    case 'failure':
    case 'timed_out':
      return 'failed';
    case 'cancelled':
      return 'canceled';
    case 'skipped':
      return 'skipped';
    default:
      return 'unknown';
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
