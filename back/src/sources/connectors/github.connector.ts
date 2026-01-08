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
  RepoVisibility,
  RepositoryRef,
  Tag,
  Branch,
} from '@repo/shared';
import type {
  CommitPullRequest,
  ConnectorContext,
  SourceConnector,
} from './source-connector.interface';
import { githubQuota, type HeaderBag, type QuotaSink } from '../../api-quota/rate-limit-headers';
import { applyScope, ageHours } from './scope.util';
import { repoUrl } from './ref-url';
import { isNotFound, unresolvableRange } from './compare';

/**
 * Most commits GitHub will report for one comparison, whatever is asked of it.
 * Stated here because it is a documented ceiling of the endpoint, not a page
 * size: past it, the range has to be read another way or not at all.
 */
const COMPARE_CAP = 250;

/** A commit as the compare endpoint shapes it — what `toCommit` reads. */
type CompareCommit = Parameters<typeof toCommit>[0];

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
    const repos = await this.listAllRepositories(ctx);
    return applyScope(
      repos.map((r) => r.name),
      ctx.scope,
    );
  }

  async listAllRepositories(ctx: ConnectorContext): Promise<RepositoryRef[]> {
    const gh = this.client(ctx);
    const repos = await gh.paginate(gh.rest.repos.listForOrg, {
      org: ctx.scope.owner,
      per_page: 100,
      type: 'all',
    });
    return repos.map((r) => ({
      name: r.name,
      // `visibility` only comes back from an instance that knows the third
      // value; everywhere else the boolean is the whole answer.
      visibility: (r.visibility === 'internal'
        ? 'internal'
        : r.private
          ? 'private'
          : 'public') as RepoVisibility,
    }));
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
          : { status: 'unknown' as PipelineStatus, environmentUrl: null, url: null };
        out.push({
          id: `gh:${repo}:${d.id}`,
          repo,
          environment: d.environment,
          ref: d.ref,
          status: state.status,
          createdAt: d.created_at,
          environmentUrl: state.environmentUrl,
          url: state.url,
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
    //
    // Either call answers 404 for a ref the platform no longer resolves, which
    // is the ordinary fate of a deployed branch — see `unresolvableRange`.
    try {
      if (from) {
        return (await this.compare(gh, owner, repo, from, to)).map((c) => toCommit(c, repo));
      }
      const log = await gh.paginate(gh.rest.repos.listCommits, {
        owner,
        repo,
        sha: to,
        per_page: 100,
      });
      return log.map((c) => toCommit(c, repo));
    } catch (e) {
      if (isNotFound(e)) throw unresolvableRange(repo, from, to);
      throw e;
    }
  }

  /**
   * Every commit of a comparison, and not just its first page.
   *
   * The `commits` array is paginated like any listing — a page of it is not the
   * range, it is the oldest handful of the range. Read in one call, a release of
   * a hundred commits came back as thirty, and the ones it dropped were dropped
   * without a word: the payload says nothing about being a page.
   *
   * `total_commits` is what makes that visible, and it is also the ceiling this
   * loop stops at. GitHub caps a comparison at 250 commits whatever is asked of
   * it; past that the range genuinely cannot be read this way, and a warning
   * beats a list that looks whole.
   */
  private async compare(
    gh: Octokit,
    owner: string,
    repo: string,
    from: string,
    to: string,
  ): Promise<CompareCommit[]> {
    const read = (page: number) =>
      gh.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${from}...${to}`,
        per_page: 100,
        page,
      });

    const first = await read(1);
    const total = first.data.total_commits;
    const commits = [...first.data.commits];
    for (let page = 2; commits.length < total; page++) {
      const next = await read(page);
      // A page the platform stops filling is the end of what it will give,
      // whatever it said the total was — without this the loop would not end.
      if (next.data.commits.length === 0) break;
      commits.push(...next.data.commits);
    }

    if (commits.length < total) {
      this.logger.warn(
        `Comparaison ${from}...${to} tronquée dans ${repo} : ${commits.length} commit(s) lus sur ${total} ` +
          `(GitHub plafonne une comparaison à ${COMPARE_CAP}).`,
      );
    }
    return commits;
  }

  async defaultBranch(ctx: ConnectorContext, repo: string): Promise<string> {
    const gh = this.client(ctx);
    const info = await gh.rest.repos.get({ owner: ctx.scope.owner, repo });
    return info.data.default_branch;
  }

  async commitPullRequests(
    ctx: ConnectorContext,
    repo: string,
    shas: string[],
  ): Promise<Map<string, CommitPullRequest>> {
    const gh = this.client(ctx);
    const requests = new Map<string, CommitPullRequest>();
    let skipped = 0;

    for (const sha of shas) {
      // One call per commit, so both guards belong inside the loop: a range of
      // two hundred commits is two hundred calls, and neither a cancelled
      // request nor an emptying budget should have to wait for the last one.
      ctx.signal?.throwIfAborted();
      if (ctx.allowsOptionalCalls?.() === false) {
        skipped++;
        continue;
      }
      try {
        const prs = await gh.rest.repos.listPullRequestsAssociatedWithCommit({
          owner: ctx.scope.owner,
          repo,
          commit_sha: sha,
          // A page rather than a single result: it is one call either way, and
          // a commit sitting in an open pull request as well as in the one that
          // landed it should be read as the change that landed.
          per_page: 20,
        });
        const merged = prs.data.find((pr) => pr.merged_at) ?? prs.data[0];
        if (merged) {
          requests.set(sha, {
            number: merged.number,
            url: merged.html_url,
            headRef: merged.head.ref,
          });
        }
      } catch {
        // A commit the platform will not associate is a commit with no request,
        // which is a case the caller handles anyway.
      }
    }

    if (skipped > 0) {
      this.logger.warn(
        `Réserve d'API atteinte : pull request non résolue pour ${skipped} commit(s) de ${repo}`,
      );
    }
    return requests;
  }

  async pullRequestCommits(
    ctx: ConnectorContext,
    repo: string,
    numbers: number[],
  ): Promise<Map<number, Commit[]>> {
    const gh = this.client(ctx);
    const commits = new Map<number, Commit[]>();
    let skipped = 0;

    for (const number of numbers) {
      // One call per request, so both guards belong inside the loop — the same
      // reasoning as the association above.
      ctx.signal?.throwIfAborted();
      if (ctx.allowsOptionalCalls?.() === false) {
        skipped++;
        continue;
      }
      try {
        const listed = await gh.paginate(gh.rest.pulls.listCommits, {
          owner: ctx.scope.owner,
          repo,
          pull_number: number,
          per_page: 100,
        });
        commits.set(
          number,
          listed.map((c) => toCommit(c, repo)),
        );
      } catch {
        // A request the platform will not detail leaves the commit that named
        // it exactly as it was, which is a case the caller handles anyway.
      }
    }

    if (skipped > 0) {
      this.logger.warn(
        `Réserve d'API atteinte : commits non lus pour ${skipped} pull request(s) de ${repo}`,
      );
    }
    return commits;
  }

  private async deploymentStatus(
    gh: Octokit,
    owner: string,
    repo: string,
    deploymentId: number,
  ): Promise<{ status: PipelineStatus; environmentUrl: string | null; url: string | null }> {
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
        // GitHub publishes no page for a deployment, so the closest thing is
        // what its status points at — the run that performed it, for anything
        // deployed by Actions. `target_url` is the older spelling of the same
        // field, still what some third-party deployers write.
        url: latest?.log_url || latest?.target_url || null,
      };
    } catch {
      return { status: 'unknown', environmentUrl: null, url: null };
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
    parents?: unknown[];
  },
  _repo: string,
): Commit {
  return {
    sha: c.sha,
    message: c.commit.message,
    author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
    authoredAt: c.commit.author?.date ?? new Date(0).toISOString(),
    url: c.html_url,
    // One when the payload says nothing: an endpoint that omits the parents is
    // read as an ordinary commit, which costs a wasted lookup at worst — where
    // reading it as a merge would silently drop a request's commits.
    parents: c.parents?.length ?? 1,
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
