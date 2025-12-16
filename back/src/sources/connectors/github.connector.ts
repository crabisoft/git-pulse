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
  Branch,
} from '@repo/shared';
import type { ConnectorContext, SourceConnector } from './source-connector.interface';
import { githubQuota, type HeaderBag, type QuotaSink } from '../../api-quota/rate-limit-headers';
import { applyScope, ageHours } from './scope.util';
import { repoUrl } from './ref-url';

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
    return repoUrl({ kind: 'github', baseUrl: ctx.baseUrl, owner: ctx.scope.owner, repo });
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
    let skipped = 0;
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
        // Under the reserve the deployment is still reported, with an unknown
        // status: it then counts towards the frequency but not towards the
        // failure rate, where dropping it would have cost both.
        const enrich = ctx.allowsOptionalCalls?.() !== false;
        if (!enrich) skipped++;
        // The status call carries the environment's URL too, so reading it
        // costs nothing extra — and giving up the call gives up both.
        const state = enrich
          ? await this.deploymentStatus(gh, ctx.scope.owner, repo, d.id)
          : { status: 'unknown' as PipelineStatus, environmentUrl: null };
        out.push({
          id: `gh:${repo}:${d.id}`,
          repo,
          environment: d.environment,
          ref: d.ref,
          status: state.status,
          createdAt: d.created_at,
          environmentUrl: state.environmentUrl,
        });
      }
    }
    if (skipped > 0) {
      this.logger.warn(
        `Statut non lu pour ${skipped} déploiement(s) : budget d'API sous la réserve.`,
      );
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
    let skipped = 0;
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
        // The heaviest fan-out of the whole collection, and the first thing
        // given up under the reserve: the pull request keeps its lead time,
        // and loses the coding and pickup segments it cuts into.
        const enrich = ctx.allowsOptionalCalls?.() !== false;
        if (!enrich) skipped++;
        const [firstCommitAt, firstReviewAt] = enrich
          ? await Promise.all([
              this.firstCommitAt(gh, ctx.scope.owner, repo, pr.number),
              this.firstReviewAt(gh, ctx.scope.owner, repo, pr.number),
            ])
          : [null, null];
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
    if (skipped > 0) {
      this.logger.warn(
        `Segments de lead time non collectés pour ${skipped} pull request(s) : ` +
          `budget d'API sous la réserve.`,
      );
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

  /**
   * Two calls, unlike GitLab's one: the branch listing does not say which is
   * the default, and that is the branch an omitted bound resolves to. Paid on a
   * picker opening rather than on a collection, so it is off the fan-out that
   * the API reserve guards.
   */
  async listBranches(ctx: ConnectorContext, repo: string): Promise<Branch[]> {
    const gh = this.client(ctx);
    const owner = ctx.scope.owner;
    const [branches, fallback] = await Promise.all([
      gh.rest.repos.listBranches({ owner, repo, per_page: 100 }),
      this.defaultBranch(ctx, repo),
    ]);
    return branches.data.map((branch) => ({
      name: branch.name,
      sha: branch.commit.sha,
      isDefault: branch.name === fallback,
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
  ): Promise<{ status: PipelineStatus; environmentUrl: string | null }> {
    try {
      const statuses = await gh.rest.repos.listDeploymentStatuses({
        owner,
        repo,
        deployment_id: deploymentId,
        per_page: 1,
      });
      const latest = statuses.data[0];
      return {
        status: mapGitHubDeploymentState(latest?.state),
        // Set by whoever wrote the status, so absent far more often than not.
        environmentUrl: latest?.environment_url || null,
      };
    } catch {
      return { status: 'unknown', environmentUrl: null };
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

  const octokit =
    ctx.auth.kind === 'app'
      ? // GitHub App: Octokit mints and caches installation tokens on demand.
        new Octokit({
          authStrategy: createAppAuth,
          auth: {
            appId: ctx.auth.appId,
            privateKey: ctx.auth.privateKey,
            installationId: ctx.auth.installationId,
          },
          baseUrl,
          request,
        })
      : new Octokit({ auth: ctx.auth.token, baseUrl, request });

  if (ctx.onQuota) meterOctokit(octokit, ctx.onQuota);
  return octokit;
}

/**
 * Reports the rate-limit headers of every call the client makes, `paginate`
 * included — the hooks sit under the request layer, which is the only place
 * every call passes through.
 */
function meterOctokit(octokit: Octokit, onQuota: QuotaSink): void {
  // Every call is reported, counters or not: a response that carries none is
  // what a declared budget is counted against, and a call that never reached
  // the server is counted with it — an attempt whose cost is unknown is closer
  // to one than to zero.
  const report = (headers: HeaderBag | undefined) => {
    onQuota(headers ? githubQuota(headers) : null);
  };

  octokit.hook.after('request', (response) => report(response.headers));
  // Failures carry the counters too, and a 403 for a spent budget is precisely
  // the reading worth keeping — dropping it would leave the gauge showing the
  // last success, just short of the limit that was actually hit.
  octokit.hook.error('request', (error) => {
    report((error as { response?: { headers?: HeaderBag } }).response?.headers);
    throw error;
  });
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

/** Shared with the webhook mapper, so an event and a listing agree on a status. */
export function mapGitHubDeploymentState(state: string | null | undefined): PipelineStatus {
  switch (state) {
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
}

/** Shared with the webhook mapper, so an event and a listing agree on a status. */
export function mapGitHubStatus(status: string | null, conclusion: string | null): PipelineStatus {
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
