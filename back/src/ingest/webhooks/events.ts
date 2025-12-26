/**
 * What an event asks the store to record.
 *
 * Pure mappers, one per provider, producing the very same shapes the connectors
 * produce — so an event and a listing write the same row through the same merge
 * rules, and neither can contradict the other about what a pull request is.
 *
 * They are deliberately total about ids: an event that named a pull request
 * differently from the listing would create a second row for it, which is the
 * one mistake this design cannot absorb. Hence `gh:<repo>:<number>` and
 * `gl:<path>:<iid>` here, spelled exactly as the connectors spell them.
 */

import type { Deployment, Pipeline, PullRequest, PullRequestState } from '@repo/shared';
import {
  mapGitHubDeploymentState,
  mapGitHubStatus,
} from '../../sources/connectors/github.connector';
import { mapGitLabStatus } from '../../sources/connectors/gitlab.connector';
import { ageHours } from '../../sources/connectors/scope.util';

/** One thing to write. Null is a perfectly good outcome — most events say nothing. */
export type IngestIntent =
  | { kind: 'pull-request'; item: PullRequest }
  | { kind: 'pipeline'; item: Pipeline }
  | { kind: 'deployment'; item: Deployment };

type Payload = Record<string, unknown>;

export function toGitHubIntent(event: string, payload: unknown): IngestIntent | null {
  const body = asObject(payload);
  if (!body) return null;
  switch (event) {
    case 'pull_request':
      return gitHubPullRequest(body);
    case 'workflow_run':
      return gitHubWorkflowRun(body);
    case 'deployment_status':
      return gitHubDeployment(body);
    default:
      return null;
  }
}

export function toGitLabIntent(event: string, payload: unknown): IngestIntent | null {
  const body = asObject(payload);
  if (!body) return null;
  switch (event) {
    case 'Merge Request Hook':
      return gitLabMergeRequest(body);
    case 'Pipeline Hook':
      return gitLabPipeline(body);
    case 'Deployment Hook':
      return gitLabDeployment(body);
    default:
      return null;
  }
}

function gitHubPullRequest(body: Payload): IngestIntent | null {
  const pr = asObject(body.pull_request);
  const repository = asObject(body.repository);
  const repo = asString(repository?.name);
  const number = asNumber(pr?.number);
  if (!pr || !repo || number === null) return null;

  const createdAt = asString(pr.created_at);
  const mergedAt = asString(pr.merged_at);
  if (!createdAt) return null;

  return {
    kind: 'pull-request',
    item: {
      id: `gh:${repo}:${number}`,
      number,
      title: asString(pr.title) ?? '',
      state: pullRequestState(asString(pr.state), asBoolean(pr.draft), mergedAt),
      author: asString(asObject(pr.user)?.login) ?? 'unknown',
      repo,
      repoUrl: asString(repository?.html_url) ?? '',
      url: asString(pr.html_url) ?? '',
      headRef: asString(asObject(pr.head)?.ref) ?? '',
      createdAt,
      // Every payload carries it; falling back to the creation date keeps the
      // staleness guard usable rather than letting the row refuse every update.
      updatedAt: asString(pr.updated_at) ?? createdAt,
      mergedAt,
      reviewers: Array.isArray(pr.requested_reviewers) ? pr.requested_reviewers.length : 0,
      ageHours: ageHours(createdAt),
      tickets: [],
    },
  };
}

function gitHubWorkflowRun(body: Payload): IngestIntent | null {
  const run = asObject(body.workflow_run);
  const repository = asObject(body.repository);
  const repo = asString(repository?.name);
  const id = asNumber(run?.id);
  const createdAt = asString(run?.created_at);
  if (!run || !repo || id === null || !createdAt) return null;

  const status = asString(run.status);
  const updatedAt = asString(run.updated_at) ?? createdAt;
  return {
    kind: 'pipeline',
    item: {
      id: `gh:${repo}:${id}`,
      repo,
      repoUrl: asString(repository?.html_url) ?? '',
      ref: asString(run.head_branch) ?? asString(run.head_sha)?.slice(0, 7) ?? '',
      status: mapGitHubStatus(status ?? null, asString(run.conclusion) ?? null),
      url: asString(run.html_url) ?? '',
      createdAt,
      updatedAt,
      durationSec:
        status === 'completed'
          ? Math.round((new Date(updatedAt).getTime() - new Date(createdAt).getTime()) / 1000)
          : null,
    },
  };
}

function gitHubDeployment(body: Payload): IngestIntent | null {
  const deployment = asObject(body.deployment);
  const repo = asString(asObject(body.repository)?.name);
  const id = asNumber(deployment?.id);
  const createdAt = asString(deployment?.created_at);
  if (!deployment || !repo || id === null || !createdAt) return null;

  return {
    kind: 'deployment',
    item: {
      id: `gh:${repo}:${id}`,
      repo,
      environment: asString(deployment.environment) ?? 'unknown',
      ref: asString(deployment.ref) ?? '',
      status: mapGitHubDeploymentState(asString(asObject(body.deployment_status)?.state)),
      createdAt,
      // The same status that carries the state carries the environment's URL.
      environmentUrl: asString(asObject(body.deployment_status)?.environment_url) ?? null,
      // And the run it came from — `target_url` being the older spelling of it.
      url:
        asString(asObject(body.deployment_status)?.log_url) ??
        asString(asObject(body.deployment_status)?.target_url) ??
        null,
    },
  };
}

function gitLabMergeRequest(body: Payload): IngestIntent | null {
  const mr = asObject(body.object_attributes);
  const project = asObject(body.project);
  const repo = asString(project?.path_with_namespace);
  const iid = asNumber(mr?.iid);
  const createdAt = asString(mr?.created_at);
  if (!mr || !repo || iid === null || !createdAt) return null;

  const mergedAt = asString(mr.merged_at);
  // `draft` on recent versions, `work_in_progress` on older ones — the same
  // thing under two names, and an install may be on either.
  const draft = asBoolean(mr.draft) || asBoolean(mr.work_in_progress);
  return {
    kind: 'pull-request',
    item: {
      id: `gl:${repo}:${iid}`,
      number: iid,
      title: asString(mr.title) ?? '',
      state: pullRequestState(asString(mr.state), draft, mergedAt),
      author: asString(asObject(body.user)?.username) ?? 'unknown',
      repo,
      repoUrl: asString(project?.web_url) ?? '',
      url: asString(mr.url) ?? '',
      headRef: asString(mr.source_branch) ?? '',
      createdAt,
      updatedAt: asString(mr.updated_at) ?? createdAt,
      mergedAt,
      reviewers: Array.isArray(body.reviewers) ? body.reviewers.length : 0,
      ageHours: ageHours(createdAt),
      tickets: [],
    },
  };
}

function gitLabPipeline(body: Payload): IngestIntent | null {
  const pipeline = asObject(body.object_attributes);
  const project = asObject(body.project);
  const repo = asString(project?.path_with_namespace);
  const id = asNumber(pipeline?.id);
  const createdAt = asString(pipeline?.created_at);
  if (!pipeline || !repo || id === null || !createdAt) return null;

  const finishedAt = asString(pipeline.finished_at);
  const webUrl = asString(project?.web_url);
  return {
    kind: 'pipeline',
    item: {
      id: `gl:${repo}:${id}`,
      repo,
      repoUrl: webUrl ?? '',
      ref: asString(pipeline.ref) ?? '',
      status: mapGitLabStatus(asString(pipeline.status) ?? ''),
      // Older versions send no URL for the pipeline itself; the canonical path
      // is stable enough to build, and a link is better than none.
      url: asString(pipeline.url) ?? (webUrl ? `${webUrl}/-/pipelines/${id}` : ''),
      createdAt,
      updatedAt: finishedAt ?? createdAt,
      // Reported directly here, unlike the listing, which would need a call per
      // pipeline to know it.
      durationSec: asNumber(pipeline.duration),
    },
  };
}

function gitLabDeployment(body: Payload): IngestIntent | null {
  const repo = asString(asObject(body.project)?.path_with_namespace);
  const id = asNumber(body.deployment_id);
  if (!repo || id === null) return null;

  // A deployment hook fires on a status change and dates that change, not the
  // deployment. Falling back keeps a creation date that only ever moves earlier
  // as better information arrives.
  const createdAt = asString(body.status_changed_at);
  if (!createdAt) return null;

  return {
    kind: 'deployment',
    item: {
      id: `gl:${repo}:${id}`,
      repo,
      environment: asString(body.environment) ?? 'unknown',
      ref: asString(body.ref) ?? '',
      status: mapGitLabStatus(asString(body.status) ?? ''),
      createdAt,
      // The hook names the environment but not its address, so the merge keeps
      // whatever a listing already stored rather than blanking it.
      environmentUrl: null,
      // The job that ran it, on the other hand, the hook does name.
      url: asString(body.deployable_url),
    },
  };
}

/**
 * A merge date settles the question whatever the provider called the state:
 * GitHub says `closed` for a merged pull request, GitLab says `merged`, and the
 * store has one answer for both.
 */
function pullRequestState(
  raw: string | null,
  draft: boolean,
  mergedAt: string | null,
): PullRequestState {
  if (mergedAt) return 'merged';
  if (raw === 'closed' || raw === 'locked') return 'closed';
  return draft ? 'draft' : 'open';
}

function asObject(value: unknown): Payload | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Payload)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}
