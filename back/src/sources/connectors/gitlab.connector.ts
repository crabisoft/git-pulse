import { Injectable, Logger } from '@nestjs/common';
import { Gitlab } from '@gitbeaker/rest';
import type {
  PullRequest,
  Pipeline,
  Deployment,
  MergedPullRequest,
  PipelineStatus,
  ConnectionTestResult,
} from '@repo/shared';
import type { ConnectorContext, SourceConnector } from './source-connector.interface';
import { applyScope, ageHours } from './scope.util';

type GitlabClient = InstanceType<typeof Gitlab>;

/** GitLab connector — gitlab.com or a self-hosted instance via baseUrl. */
@Injectable()
export class GitLabConnector implements SourceConnector {
  readonly kind = 'gitlab';
  private readonly logger = new Logger(GitLabConnector.name);

  /**
   * gitbeaker gives no way in: its request helper rebuilds the signal from
   * `queryTimeout` and drops any the caller passes into the query string
   * (@gitbeaker/core, `get()`). Cancellation is therefore honoured between
   * repos rather than at the HTTP call — which is where the cost is anyway,
   * since these methods iterate repo by repo.
   */
  private client(ctx: ConnectorContext): GitlabClient {
    if (ctx.auth.kind !== 'token') {
      throw new Error('GitLab supports token authentication only.');
    }
    return new Gitlab({
      host: ctx.baseUrl.replace(/\/$/, ''),
      token: ctx.auth.token,
    });
  }

  /** Web URL of a project from its path_with_namespace. */
  private repoUrl(ctx: ConnectorContext, repo: string): string {
    return `${ctx.baseUrl.replace(/\/$/, '')}/${repo}`;
  }

  async testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult> {
    try {
      const gl = this.client(ctx);
      await gl.Groups.show(ctx.scope.owner);
      return { ok: true, message: { code: 'sources.test.ok', params: { owner: ctx.scope.owner } } };
    } catch (e) {
      return { ok: false, message: { code: 'sources.test.failed', params: { error: asMessage(e) } } };
    }
  }

  async listRepositories(ctx: ConnectorContext): Promise<string[]> {
    const gl = this.client(ctx);
    const projects = await gl.Groups.allProjects(ctx.scope.owner, {
      includeSubgroups: true,
      perPage: 100,
    });
    return applyScope(
      projects.map((p) => p.path_with_namespace as string),
      ctx.scope,
    );
  }

  async listPullRequests(ctx: ConnectorContext, repos: string[]): Promise<PullRequest[]> {
    const gl = this.client(ctx);
    const out: PullRequest[] = [];
    for (const repo of repos) {
      ctx.signal?.throwIfAborted();
      const mrs = await gl.MergeRequests.all({
        projectId: repo,
        state: 'opened',
        perPage: 100,
      });
      for (const mr of mrs) {
        const createdAt = mr.created_at as string;
        out.push({
          id: `gl:${repo}:${mr.iid}`,
          number: mr.iid as number,
          title: mr.title as string,
          state: (mr.draft as boolean) ? 'draft' : 'open',
          author: (mr.author as { username?: string })?.username ?? 'unknown',
          repo,
          repoUrl: this.repoUrl(ctx, repo),
          url: mr.web_url as string,
          createdAt,
          updatedAt: mr.updated_at as string,
          mergedAt: (mr.merged_at as string) ?? null,
          reviewers: Array.isArray(mr.reviewers) ? mr.reviewers.length : 0,
          ageHours: ageHours(createdAt),
        });
      }
    }
    return out;
  }

  async listPipelines(ctx: ConnectorContext, repos: string[]): Promise<Pipeline[]> {
    const gl = this.client(ctx);
    const out: Pipeline[] = [];
    for (const repo of repos) {
      ctx.signal?.throwIfAborted();
      const pipelines = await gl.Pipelines.all(repo, { perPage: 20 });
      for (const p of pipelines) {
        out.push({
          id: `gl:${repo}:${p.id}`,
          repo,
          repoUrl: this.repoUrl(ctx, repo),
          ref: p.ref as string,
          status: mapGitLabStatus(p.status as string),
          url: p.web_url as string,
          createdAt: p.created_at as string,
          updatedAt: (p.updated_at as string) ?? (p.created_at as string),
          // Duration needs a per-pipeline Pipelines.show call.
          durationSec: null,
        });
      }
    }
    return out;
  }

  async listDeployments(ctx: ConnectorContext, repos: string[]): Promise<Deployment[]> {
    const gl = this.client(ctx);
    const out: Deployment[] = [];
    for (const repo of repos) {
      ctx.signal?.throwIfAborted();
      const deployments = await gl.Deployments.all(repo, { perPage: 30 });
      for (const d of deployments) {
        out.push({
          id: `gl:${repo}:${d.id}`,
          repo,
          environment: (d.environment as { name?: string })?.name ?? 'unknown',
          ref: (d.ref as string) ?? '',
          status: mapGitLabStatus(d.status as string),
          createdAt: d.created_at as string,
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
    const gl = this.client(ctx);
    const sinceMs = new Date(since).getTime();
    const out: MergedPullRequest[] = [];
    for (const repo of repos) {
      ctx.signal?.throwIfAborted();
      const mrs = await gl.MergeRequests.all({
        projectId: repo,
        state: 'merged',
        updatedAfter: since,
        perPage: 50,
      });
      for (const mr of mrs) {
        const mergedAt = mr.merged_at as string | null;
        if (!mergedAt || new Date(mergedAt).getTime() < sinceMs) continue;
        // One extra call per MR: worth checking inside this loop too.
        ctx.signal?.throwIfAborted();
        out.push({
          id: `gl:${repo}:${mr.iid}`,
          repo,
          number: mr.iid as number,
          url: mr.web_url as string,
          openedAt: mr.created_at as string,
          firstCommitAt: await this.firstCommitAt(gl, repo, mr.iid as number),
          // GitLab has no GitHub-style reviews; pickup/review are not derived.
          firstReviewAt: null,
          mergedAt,
        });
      }
    }
    return out;
  }

  private async firstCommitAt(gl: GitlabClient, repo: string, iid: number): Promise<string | null> {
    try {
      const commits = await gl.MergeRequests.allCommits(repo, iid);
      if (commits.length === 0) return null;
      const oldest = commits.reduce((min, c) => {
        const t = new Date(c.created_at as string).getTime();
        return t < min ? t : min;
      }, Number.POSITIVE_INFINITY);
      return Number.isFinite(oldest) ? new Date(oldest).toISOString() : null;
    } catch {
      return null;
    }
  }
}

function mapGitLabStatus(status: string): PipelineStatus {
  switch (status) {
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'pending':
      return 'pending';
    case 'canceled':
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
