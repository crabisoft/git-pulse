import { describe, expect, it, vi } from 'vitest';
import type { Commit } from '@repo/shared';
import type { TicketRulesService } from '../ticket-rules/ticket-rules.service';
import type { RepoLocation } from '../sources/connectors/ref-url';
import type {
  CommitPullRequest,
  ConnectorContext,
  SourceConnector,
} from '../sources/connectors/source-connector.interface';
import { ReleaseNotesService } from './release-notes.service';

const CTX = { baseUrl: 'https://api.github.com', scope: { owner: 'acme' } } as ConnectorContext;
const GITHUB: RepoLocation = {
  kind: 'github',
  baseUrl: 'https://api.github.com',
  owner: 'acme',
  repo: 'widget',
};

function commit(sha: string, message: string, parents = 1): Commit {
  return {
    sha,
    message,
    author: 'Ada',
    authoredAt: '2026-07-01T10:00:00Z',
    url: `https://github.com/acme/widget/commit/${sha}`,
    parents,
  };
}

function request(number: number, headRef: string): CommitPullRequest {
  return { number, url: `https://github.com/acme/widget/pull/${number}`, headRef };
}

/**
 * The service with only what `describeCommits` reaches: the rules, and the
 * connector it is handed. Everything else belongs to `generate`.
 */
function service(
  hasRules = true,
  resolved = new Map<string, CommitPullRequest>(),
  requestCommits = new Map<number, Commit[]>(),
) {
  const extractMany = vi.fn().mockImplementation((_id, texts: unknown[]) => texts.map(() => []));
  const commitPullRequests = vi.fn().mockResolvedValue(resolved);
  const pullRequestCommits = vi.fn().mockResolvedValue(requestCommits);
  const rules = {
    extractMany,
    anyFor: vi.fn().mockResolvedValue(hasRules),
  } as unknown as TicketRulesService;
  const connector = { commitPullRequests, pullRequestCommits } as unknown as SourceConnector;
  const notes = new ReleaseNotesService(
    null as never,
    null as never,
    rules,
    null as never,
    null as never,
    null as never,
  );
  return { notes, connector, extractMany, commitPullRequests, pullRequestCommits };
}

/** The (branch, title) pairs the extraction was actually run over. */
function texts(extractMany: ReturnType<typeof vi.fn>) {
  return extractMany.mock.calls[0][1];
}

describe('describeCommits', () => {
  it('links the request a merge commit names, without asking the platform', async () => {
    const { notes, connector, extractMany, commitPullRequests } = service();

    const [entry] = await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('aaa', 'Merge pull request #42 from acme/ABC-1-login', 2),
    ]);

    expect(entry.pullRequest).toEqual({
      number: 42,
      url: 'https://github.com/acme/widget/pull/42',
    });
    expect(texts(extractMany)).toEqual([
      { branch: 'ABC-1-login', title: 'Merge pull request #42 from acme/ABC-1-login' },
    ]);
    expect(commitPullRequests).not.toHaveBeenCalled();
  });

  it('builds the merge request address a GitLab source expects', async () => {
    const { notes, connector } = service();
    const gitlab: RepoLocation = {
      kind: 'gitlab',
      baseUrl: 'https://gitlab.acme.io',
      owner: 'acme',
      repo: 'group/widget',
    };
    const message = ["Merge branch 'ABC-1' into 'main'", '', 'See merge request acme/widget!42'].join(
      '\n',
    );

    const [entry] = await notes.describeCommits('src-1', connector, CTX, gitlab, [
      commit('aaa', message, 2),
    ]);

    expect(entry.pullRequest?.url).toBe('https://gitlab.acme.io/group/widget/-/merge_requests/42');
  });

  it('resolves the request of the commits a merge brought in with it', async () => {
    // The children carry nothing of their own: only the association does.
    const { notes, connector, extractMany, commitPullRequests } = service(
      true,
      new Map([['bbb', request(42, 'ABC-1-login')]]),
    );

    const entries = await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('aaa', 'Merge pull request #42 from acme/ABC-1-login', 2),
      commit('bbb', 'fix: stop dropping the cursor'),
    ]);

    expect(commitPullRequests).toHaveBeenCalledWith(CTX, 'widget', ['bbb']);
    expect(entries.map((e) => e.pullRequest?.number)).toEqual([42, 42]);
    expect(texts(extractMany)).toEqual([
      { branch: 'ABC-1-login', title: 'Merge pull request #42 from acme/ABC-1-login' },
      { branch: 'ABC-1-login', title: 'fix: stop dropping the cursor' },
    ]);
  });

  it('asks for the branch a squash dropped, keeping the number it kept', async () => {
    const { notes, connector, extractMany, commitPullRequests } = service(
      true,
      new Map([['ccc', request(42, 'ABC-1-login')]]),
    );

    await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('ccc', 'feat(sources): collect on demand (#42)'),
    ]);

    expect(commitPullRequests).toHaveBeenCalledWith(CTX, 'widget', ['ccc']);
    expect(texts(extractMany)).toEqual([
      { branch: 'ABC-1-login', title: 'feat(sources): collect on demand (#42)' },
    ]);
  });

  it('expands a squash into the commits it was made of', async () => {
    // Squashing collapses a branch into one commit, so its work is nowhere in
    // the range: the request is the only place it survives.
    const { notes, connector, pullRequestCommits } = service(
      true,
      new Map([['ccc', request(42, 'ABC-1-login')]]),
      new Map([[42, [commit('d1', 'feat: the form'), commit('d2', 'test: the form')]]]),
    );

    const entries = await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('ccc', 'feat(sources): collect on demand (#42)'),
    ]);

    expect(pullRequestCommits).toHaveBeenCalledWith(CTX, 'widget', [42]);
    expect(entries.map((e) => e.sha)).toEqual(['d1', 'd2']);
    // The children came in on the request their squash named, so they carry it
    // without a lookup of their own.
    expect(entries.every((e) => e.pullRequest?.number === 42)).toBe(true);
  });

  it('leaves a merge commit alone — what it brought in is already in the range', async () => {
    const { notes, connector, pullRequestCommits } = service(
      true,
      new Map([['bbb', request(42, 'ABC-1-login')]]),
    );

    const entries = await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('aaa', 'Merge pull request #42 from acme/ABC-1-login', 2),
      commit('bbb', 'feat: the form'),
    ]);

    expect(pullRequestCommits).not.toHaveBeenCalled();
    expect(entries.map((e) => e.sha)).toEqual(['aaa', 'bbb']);
  });

  it('keeps the squash when the request answers nothing — the reserve, or a deleted repo', async () => {
    const { notes, connector } = service(true, new Map([['ccc', request(42, 'ABC-1-login')]]));

    const entries = await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('ccc', 'feat(sources): collect on demand (#42)'),
    ]);

    expect(entries.map((e) => e.sha)).toEqual(['ccc']);
  });

  it('never lists a commit twice when a request answers with one the range holds', async () => {
    const { notes, connector } = service(
      true,
      new Map([['ccc', request(42, 'ABC-1-login')]]),
      new Map([[42, [commit('ccc', 'feat(sources): collect on demand (#42)')]]]),
    );

    const entries = await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('ccc', 'feat(sources): collect on demand (#42)'),
    ]);

    expect(entries.map((e) => e.sha)).toEqual(['ccc']);
  });

  it('asks nothing of a squash when no rule reaches the source', async () => {
    // The number is the link, and the message already gave it; the branch would
    // then be extracted from for nobody.
    const { notes, connector, commitPullRequests } = service(false);

    const [entry] = await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('ccc', 'feat(sources): collect on demand (#42)'),
    ]);

    expect(commitPullRequests).not.toHaveBeenCalled();
    expect(entry.pullRequest?.number).toBe(42);
  });

  it('still resolves a commit the message says nothing about, rules or not', async () => {
    // The link is wanted for its own sake: an install with no tracker still
    // reads its release notes.
    const { notes, connector, commitPullRequests } = service(
      false,
      new Map([['ddd', request(7, 'ABC-2')]]),
    );

    const [entry] = await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('ddd', 'chore: bump the lockfile'),
    ]);

    expect(commitPullRequests).toHaveBeenCalledWith(CTX, 'widget', ['ddd']);
    expect(entry.pullRequest?.number).toBe(7);
  });

  it('leaves a commit no request claims without one', async () => {
    const { notes, connector, extractMany } = service(true, new Map());

    const [entry] = await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('eee', 'chore: bump the lockfile'),
    ]);

    expect(entry.pullRequest).toBeNull();
    expect(texts(extractMany)).toEqual([{ branch: '', title: 'chore: bump the lockfile' }]);
  });

  it('keeps the entries positional with the commits it was given', async () => {
    const { notes, connector } = service(true, new Map([['bbb', request(7, 'ABC-2')]]));

    const entries = await notes.describeCommits('src-1', connector, CTX, GITHUB, [
      commit('aaa', 'feat: one'),
      commit('bbb', 'feat: two'),
    ]);

    expect(entries.map((e) => e.sha)).toEqual(['aaa', 'bbb']);
    expect(entries.map((e) => e.summary)).toEqual(['one', 'two']);
  });
});
