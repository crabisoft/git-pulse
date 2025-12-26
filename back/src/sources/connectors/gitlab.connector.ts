import { Injectable, Logger } from '@nestjs/common';
import { Gitlab } from '@gitbeaker/rest';
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
import { gitlabQuota, type HeaderBag, type QuotaSink } from '../../api-quota/rate-limit-headers';
import { applyScope, ageHours } from './scope.util';
import { repoUrl } from './ref-url';

export type GitlabClient = InstanceType<typeof Gitlab>;

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
    return gitlabFor(ctx);
  }

  /** Web URL of a project from its path_with_namespace. */
  private repoUrl(ctx: ConnectorContext, repo: string): string {
    return repoUrl({ kind: 'gitlab', baseUrl: ctx.baseUrl, owner: ctx.scope.owner, repo });
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
    const projects = await this.listAllRepositories(ctx);
    return applyScope(
      projects.map((p) => p.name),
      ctx.scope,
    );
  }

  async listAllRepositories(ctx: ConnectorContext): Promise<RepositoryRef[]> {
    const gl = this.client(ctx);
    const projects = await gl.Groups.allProjects(ctx.scope.owner, {
      includeSubgroups: true,
      perPage: 100,
    });
    return projects.map((p) => ({
      name: p.path_with_namespace as string,
      // An instance may answer with something newer than the three we know:
      // anything unrecognised is treated as the closed case, never as public.
      visibility: (p.visibility === 'public' || p.visibility === 'internal'
        ? p.visibility
        : 'private') as RepoVisibility,
    }));
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
          headRef: (mr.source_branch as string | undefined) ?? '',
          createdAt,
          updatedAt: mr.updated_at as string,
          mergedAt: (mr.merged_at as string) ?? null,
          reviewers: Array.isArray(mr.reviewers) ? mr.reviewers.length : 0,
          ageHours: ageHours(createdAt),
          // Filled by the service, which owns the rules.
          tickets: [],
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
        // The environment travels embedded in the listing, so its external URL
        // comes free — when the environment was configured with one at all.
        const environment = d.environment as
          | { id?: number; name?: string; external_url?: string }
          | undefined;
        // The job that performed it, which is what GitLab's own environment
        // table links each deployment to. A deployment created through the API
        // carries none, and then the environment's page is the closest thing
        // the platform does publish about it.
        const job = (d.deployable as { web_url?: string } | undefined)?.web_url;
        const environmentPage =
          environment?.id === undefined
            ? null
            : `${this.repoUrl(ctx, repo)}/-/environments/${environment.id}`;
        out.push({
          id: `gl:${repo}:${d.id}`,
          repo,
          environment: environment?.name ?? 'unknown',
          ref: (d.ref as string) ?? '',
          status: mapGitLabStatus(d.status as string),
          createdAt: d.created_at as string,
          environmentUrl: environment?.external_url || null,
          url: job || environmentPage,
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
    let skipped = 0;
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
        const author = (mr.author as { id?: number } | undefined)?.id ?? null;
        // The heaviest fan-out of the whole collection, and the first thing
        // given up under the reserve: the merge request keeps its lead time,
        // and loses the coding and pickup segments it cuts into.
        const enrich = ctx.allowsOptionalCalls?.() !== false;
        if (!enrich) skipped++;
        const [firstCommitAt, firstReviewAt] = enrich
          ? await Promise.all([
              this.firstCommitAt(gl, repo, mr.iid as number),
              this.firstReviewAt(gl, repo, mr.iid as number, author),
            ])
          : [null, null];
        out.push({
          id: `gl:${repo}:${mr.iid}`,
          repo,
          number: mr.iid as number,
          title: mr.title as string,
          url: mr.web_url as string,
          headRef: (mr.source_branch as string | undefined) ?? '',
          openedAt: mr.created_at as string,
          firstCommitAt,
          firstReviewAt,
          mergedAt,
        });
      }
    }
    if (skipped > 0) {
      this.logger.warn(
        `Segments de lead time non collectés pour ${skipped} merge request(s) : ` +
          `budget d'API sous la réserve.`,
      );
    }
    return out;
  }

  async listTags(ctx: ConnectorContext, repo: string): Promise<Tag[]> {
    const gl = this.client(ctx);
    const tags = await gl.Tags.all(repo, { perPage: 100 });
    return tags.map((tag) => ({
      name: tag.name as string,
      sha: (tag.commit as { id?: string } | undefined)?.id ?? '',
      // Annotated tags date themselves; lightweight ones do not.
      taggedAt: ((tag.commit as { created_at?: string } | undefined)?.created_at as string) ?? null,
    }));
  }

  /** One call: GitLab marks the default branch on the listing itself. */
  async listBranches(ctx: ConnectorContext, repo: string): Promise<Branch[]> {
    const gl = this.client(ctx);
    const branches = await gl.Branches.all(repo, { perPage: 100 });
    return branches.map((branch) => ({
      name: branch.name as string,
      sha: (branch.commit as { id?: string } | undefined)?.id ?? '',
      isDefault: Boolean(branch.default),
    }));
  }

  async listCommitsBetween(
    ctx: ConnectorContext,
    repo: string,
    from: string | null,
    to: string,
  ): Promise<Commit[]> {
    const gl = this.client(ctx);
    const baseUrl = ctx.baseUrl.replace(/\/$/, '');

    // Same split as the other connector: a compare when both bounds exist,
    // otherwise the log, since there is nothing to compare a first release to.
    if (from) {
      const diff = await gl.Repositories.compare(repo, from, to);
      const commits = (diff.commits ?? []) as Array<Record<string, unknown>>;
      return commits.map((c) => toCommit(c, baseUrl, repo));
    }
    const log = await gl.Commits.all(repo, { refName: to, perPage: 100 });
    return (log as Array<Record<string, unknown>>).map((c) => toCommit(c, baseUrl, repo));
  }

  async defaultBranch(ctx: ConnectorContext, repo: string): Promise<string> {
    const gl = this.client(ctx);
    const project = await gl.Projects.show(repo);
    return (project.default_branch as string) ?? 'main';
  }

  async commitPullRequests(
    ctx: ConnectorContext,
    repo: string,
    shas: string[],
  ): Promise<Map<string, CommitPullRequest>> {
    const gl = this.client(ctx);
    const requests = new Map<string, CommitPullRequest>();
    let skipped = 0;

    for (const sha of shas) {
      // One call per commit: both guards belong inside the loop, for the same
      // reason they do on the other platform.
      ctx.signal?.throwIfAborted();
      if (ctx.allowsOptionalCalls?.() === false) {
        skipped++;
        continue;
      }
      try {
        const mrs = (await gl.Commits.allMergeRequests(repo, sha)) as Array<
          Record<string, unknown>
        >;
        // Merged first: a commit sitting in an open merge request as well as in
        // the one that landed it should be read as the change that landed.
        const merged = mrs.find((mr) => mr.state === 'merged') ?? mrs[0];
        const iid = merged?.iid as number | undefined;
        if (merged && iid !== undefined) {
          requests.set(sha, {
            number: iid,
            url: merged.web_url as string,
            headRef: (merged.source_branch as string | undefined) ?? '',
          });
        }
      } catch {
        // Same as elsewhere: an association the instance will not give is a
        // commit with no request, which the caller already handles.
      }
    }

    if (skipped > 0) {
      this.logger.warn(
        `Réserve d'API atteinte : merge request non résolue pour ${skipped} commit(s) de ${repo}`,
      );
    }
    return requests;
  }

  /**
   * GitLab has no review object, so the closest honest signal is the first
   * comment left by someone other than the author. System notes are skipped:
   * a label change or an assignment is the platform talking, not a reviewer.
   *
   * An approximation, and stated as one — but a merge request nobody ever
   * commented on used to make pickup and review times permanently empty, which
   * read as "instant" rather than "not measurable here".
   */
  private async firstReviewAt(
    gl: GitlabClient,
    repo: string,
    iid: number,
    authorId: number | null,
  ): Promise<string | null> {
    try {
      const notes = await gl.MergeRequestNotes.all(repo, iid);
      const reviews = notes
        .filter((note) => !(note.system as boolean))
        .filter((note) => (note.author as { id?: number } | undefined)?.id !== authorId)
        .map((note) => new Date(note.created_at as string).getTime())
        .filter((at) => Number.isFinite(at));
      return reviews.length > 0 ? new Date(Math.min(...reviews)).toISOString() : null;
    } catch {
      return null;
    }
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

/** GitLab client for a source context — shared with the incident provider. */
export function gitlabFor(ctx: ConnectorContext): GitlabClient {
  if (ctx.auth.kind !== 'token') {
    throw new Error('GitLab supports token authentication only.');
  }
  const client = new Gitlab({
    host: ctx.baseUrl.replace(/\/$/, ''),
    token: ctx.auth.token,
  });
  if (ctx.onQuota) meterGitlab(client, ctx.onQuota);
  return client;
}

/**
 * Reports the rate-limit headers of every call the client makes.
 *
 * Same obstacle as the abort signal above: gitbeaker exposes no response hook.
 * Its constructor does take a `requesterFn`, but its default one is private, so
 * supplying ours would mean re-implementing its retry and parsing rules and
 * keeping them in step with the library. Wrapping the requesters it has already
 * built leaves that logic untouched — `Gitlab` assigns every resource as an own
 * property, and each holds the requester its calls go through, pagination
 * included.
 */
function meterGitlab(client: GitlabClient, onQuota: QuotaSink): void {
  // Every call is reported, counters or not — and here that is the common case
  // rather than the exception: an instance with rate limiting switched off
  // sends no header at all, and a declared budget is the only thing left to
  // count its calls against.
  const report = (headers: HeaderBag | undefined) => {
    onQuota(headers ? gitlabQuota(headers) : null);
  };

  for (const resource of Object.values(client as unknown as Record<string, unknown>)) {
    const holder = resource as { requester?: Requester };
    if (!holder?.requester) continue;
    holder.requester = meterRequester(holder.requester, report);
  }
}

const REQUESTER_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * The slice of gitbeaker's requester that matters here — its five verbs, and
 * the headers their responses carry. Described locally rather than imported:
 * `@gitbeaker/requester-utils` is a transitive dependency, and this shape is
 * small enough that declaring it beats pinning a second package.
 */
type Requester = Record<
  (typeof REQUESTER_METHODS)[number],
  (endpoint: string, options?: unknown) => Promise<{ headers?: HeaderBag }>
>;

/** The same requester, reporting what each response says about the budget. */
function meterRequester(
  requester: Requester,
  report: (headers: HeaderBag | undefined) => void,
): Requester {
  const metered = {} as Requester;
  for (const method of REQUESTER_METHODS) {
    metered[method] = async (endpoint, options) => {
      try {
        const response = await requester[method](endpoint, options);
        report(response.headers);
        return response;
      } catch (e) {
        // A 429 is the one reading that must not be lost: it is the moment the
        // budget ran out, and gitbeaker only surfaces it through the error.
        report((e as { cause?: { response?: { headers?: HeaderBag } } }).cause?.response?.headers);
        throw e;
      }
    };
  }
  return metered;
}

function toCommit(c: Record<string, unknown>, baseUrl: string, repo: string): Commit {
  const sha = (c.id as string) ?? '';
  return {
    sha,
    message: (c.message as string) ?? (c.title as string) ?? '',
    author: (c.author_name as string) ?? 'unknown',
    authoredAt: (c.authored_date as string) ?? (c.created_at as string) ?? new Date(0).toISOString(),
    url: (c.web_url as string) ?? `${baseUrl}/${repo}/-/commit/${sha}`,
  };
}

/** Shared with the webhook mapper, so an event and a listing agree on a status. */
export function mapGitLabStatus(status: string): PipelineStatus {
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
