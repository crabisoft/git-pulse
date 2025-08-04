import { Injectable, Logger } from '@nestjs/common';
import { Gitlab } from '@gitbeaker/rest';
import type { PullRequest, Pipeline, Deployment, PipelineStatus } from '@repo/shared';
import type { ConnectorContext, SourceConnector } from './source-connector.interface';
import { applyScope, ageHours } from './scope.util';

type GitlabClient = InstanceType<typeof Gitlab>;

/** GitLab connector — gitlab.com or a self-hosted instance via baseUrl. */
@Injectable()
export class GitLabConnector implements SourceConnector {
  readonly kind = 'gitlab';
  private readonly logger = new Logger(GitLabConnector.name);

  private client(ctx: ConnectorContext): GitlabClient {
    return new Gitlab({
      host: ctx.baseUrl.replace(/\/$/, ''),
      token: ctx.token,
    });
  }

  async testConnection(ctx: ConnectorContext) {
    try {
      const gl = this.client(ctx);
      await gl.Groups.show(ctx.scope.owner);
      return { ok: true, message: `Connexion GitLab OK pour le groupe "${ctx.scope.owner}".` };
    } catch (e) {
      return { ok: false, message: `Échec de connexion GitLab : ${asMessage(e)}` };
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
      const pipelines = await gl.Pipelines.all(repo, { perPage: 20 });
      for (const p of pipelines) {
        out.push({
          id: `gl:${repo}:${p.id}`,
          repo,
          ref: p.ref as string,
          status: mapGitLabStatus(p.status as string),
          url: p.web_url as string,
          createdAt: p.created_at as string,
          updatedAt: (p.updated_at as string) ?? (p.created_at as string),
          // Duration needs a per-pipeline Pipelines.show call — Phase 2.
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
