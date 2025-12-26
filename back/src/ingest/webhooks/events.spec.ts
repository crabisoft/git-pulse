import { describe, expect, it } from 'vitest';
import { toGitHubIntent, toGitLabIntent } from './events';

const GH_REPO = { name: 'api', html_url: 'https://github.com/acme/api' };
const GL_PROJECT = {
  path_with_namespace: 'acme/api',
  web_url: 'https://gitlab.acme.io/acme/api',
};

describe('toGitHubIntent', () => {
  const pullRequest = {
    action: 'opened',
    repository: GH_REPO,
    pull_request: {
      number: 42,
      title: 'Ajoute la pagination',
      state: 'open',
      draft: false,
      user: { login: 'alice' },
      html_url: 'https://github.com/acme/api/pull/42',
      head: { ref: 'feat/pagination' },
      created_at: '2026-07-20T08:00:00Z',
      updated_at: '2026-07-25T08:00:00Z',
      merged_at: null,
      requested_reviewers: [{ login: 'bob' }, { login: 'carol' }],
    },
  };

  it('names a pull request exactly as the connector does', () => {
    // The whole design rests on this: a different id means a second row for the
    // same pull request, and two answers to what state it is in.
    const intent = toGitHubIntent('pull_request', pullRequest);
    expect(intent).toMatchObject({ kind: 'pull-request', item: { id: 'gh:api:42' } });
  });

  it('reads a merge from the date rather than from the state', () => {
    // GitHub calls a merged pull request `closed`.
    const merged = {
      ...pullRequest,
      action: 'closed',
      pull_request: {
        ...pullRequest.pull_request,
        state: 'closed',
        merged_at: '2026-07-26T10:00:00Z',
      },
    };
    expect(toGitHubIntent('pull_request', merged)).toMatchObject({
      item: { state: 'merged', mergedAt: '2026-07-26T10:00:00Z' },
    });
  });

  it('carries the author and the reviewers an event knows', () => {
    expect(toGitHubIntent('pull_request', pullRequest)).toMatchObject({
      item: { author: 'alice', reviewers: 2 },
    });
  });

  it('maps a finished workflow run to its duration', () => {
    const intent = toGitHubIntent('workflow_run', {
      repository: GH_REPO,
      workflow_run: {
        id: 900,
        head_branch: 'main',
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/acme/api/actions/runs/900',
        created_at: '2026-07-27T10:00:00Z',
        updated_at: '2026-07-27T10:05:12Z',
      },
    });
    expect(intent).toMatchObject({
      kind: 'pipeline',
      item: { id: 'gh:api:900', status: 'success', durationSec: 312 },
    });
  });

  it('takes a deployment status from the status object', () => {
    const intent = toGitHubIntent('deployment_status', {
      repository: GH_REPO,
      deployment: { id: 7, environment: 'prod', ref: 'main', created_at: '2026-07-27T10:00:00Z' },
      deployment_status: { state: 'failure' },
    });
    expect(intent).toMatchObject({
      kind: 'deployment',
      item: { id: 'gh:api:7', environment: 'prod', status: 'failed', url: null },
    });
  });

  it('takes the run a deployment status points at, whichever name it uses', () => {
    const run = 'https://github.com/acme/api/actions/runs/42';
    for (const status of [{ log_url: run }, { target_url: run }]) {
      const intent = toGitHubIntent('deployment_status', {
        repository: GH_REPO,
        deployment: { id: 7, environment: 'prod', ref: 'main', created_at: '2026-07-27T10:00:00Z' },
        deployment_status: { state: 'success', ...status },
      });
      expect(intent).toMatchObject({ kind: 'deployment', item: { url: run } });
    }
  });

  it('says nothing about an event it does not handle', () => {
    expect(toGitHubIntent('star', { repository: GH_REPO })).toBeNull();
  });

  it('refuses a payload missing what identifies the row', () => {
    expect(toGitHubIntent('pull_request', { repository: GH_REPO })).toBeNull();
    expect(toGitHubIntent('pull_request', 'nope')).toBeNull();
  });
});

describe('toGitLabIntent', () => {
  const mergeRequest = {
    object_kind: 'merge_request',
    user: { username: 'alice' },
    project: GL_PROJECT,
    reviewers: [{ username: 'bob' }],
    object_attributes: {
      iid: 42,
      title: 'Ajoute la pagination',
      state: 'opened',
      work_in_progress: false,
      source_branch: 'feat/pagination',
      url: 'https://gitlab.acme.io/acme/api/-/merge_requests/42',
      created_at: '2026-07-20T08:00:00Z',
      updated_at: '2026-07-25T08:00:00Z',
      merged_at: null,
    },
  };

  it('names a merge request exactly as the connector does', () => {
    expect(toGitLabIntent('Merge Request Hook', mergeRequest)).toMatchObject({
      kind: 'pull-request',
      item: { id: 'gl:acme/api:42', repo: 'acme/api' },
    });
  });

  it('reads a draft under either of the two names GitLab uses', () => {
    const old = { ...mergeRequest, object_attributes: { ...mergeRequest.object_attributes, work_in_progress: true } };
    const recent = { ...mergeRequest, object_attributes: { ...mergeRequest.object_attributes, draft: true } };
    expect(toGitLabIntent('Merge Request Hook', old)).toMatchObject({ item: { state: 'draft' } });
    expect(toGitLabIntent('Merge Request Hook', recent)).toMatchObject({ item: { state: 'draft' } });
  });

  it('carries the duration a pipeline event reports', () => {
    // The listing cannot: it would need one call per pipeline to know it.
    const intent = toGitLabIntent('Pipeline Hook', {
      project: GL_PROJECT,
      object_attributes: {
        id: 900,
        ref: 'main',
        status: 'success',
        duration: 312,
        created_at: '2026-07-27T10:00:00Z',
        finished_at: '2026-07-27T10:05:12Z',
      },
    });
    expect(intent).toMatchObject({
      kind: 'pipeline',
      item: {
        id: 'gl:acme/api:900',
        status: 'success',
        durationSec: 312,
        url: 'https://gitlab.acme.io/acme/api/-/pipelines/900',
      },
    });
  });

  it('maps a deployment hook to its deployment id', () => {
    const intent = toGitLabIntent('Deployment Hook', {
      project: GL_PROJECT,
      deployment_id: 7,
      deployable_id: 99,
      environment: 'prod',
      ref: 'main',
      status: 'running',
      status_changed_at: '2026-07-27T10:00:00Z',
      deployable_url: 'https://gitlab.example.com/acme/api/-/jobs/99',
    });
    expect(intent).toMatchObject({
      kind: 'deployment',
      item: {
        id: 'gl:acme/api:7',
        environment: 'prod',
        status: 'running',
        url: 'https://gitlab.example.com/acme/api/-/jobs/99',
      },
    });
  });

  it('says nothing about an event it does not handle', () => {
    expect(toGitLabIntent('Push Hook', { project: GL_PROJECT })).toBeNull();
  });
});
