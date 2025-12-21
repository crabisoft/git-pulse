import { describe, expect, it } from 'vitest';
import { readMergeCommit } from './merge-commit';

describe('readMergeCommit', () => {
  it('reads the number and the head branch of a GitHub merge commit', () => {
    expect(readMergeCommit('Merge pull request #42 from acme/ABC-123-fix-login', 'github')).toEqual(
      { number: 42, branch: 'ABC-123-fix-login' },
    );
  });

  it('keeps the slashes inside a branch name, dropping only the owner', () => {
    expect(readMergeCommit('Merge pull request #42 from acme/feature/ABC-123', 'github')).toEqual({
      number: 42,
      branch: 'feature/ABC-123',
    });
  });

  it('reads a fork the same way — the owner is a prefix either way', () => {
    expect(
      readMergeCommit('Merge pull request #7 from contributor/ABC-9\n\nFix the thing', 'github'),
    ).toEqual({ number: 7, branch: 'ABC-9' });
  });

  it('reads the number of a squash, which kept no branch to read', () => {
    expect(readMergeCommit('feat(sources): collect on demand (#42)', 'github')).toEqual({
      number: 42,
      branch: null,
    });
  });

  it('leaves a GitLab `#42` alone: there it is an issue, not a merge request', () => {
    expect(readMergeCommit('feat(sources): collect on demand (#42)', 'gitlab')).toEqual({
      number: null,
      branch: null,
    });
  });

  it('reads the number and the source branch of a GitLab merge commit', () => {
    const message = [
      "Merge branch 'ABC-123-fix-login' into 'main'",
      '',
      'Fix the login',
      '',
      'See merge request acme/widget!42',
    ].join('\n');

    expect(readMergeCommit(message, 'gitlab')).toEqual({
      number: 42,
      branch: 'ABC-123-fix-login',
    });
  });

  it('refuses a plain merge, which names the branch merged in, not the change', () => {
    // `git merge main` on a feature branch: reading it would attribute main's
    // tickets and, worse, stop the real branch from being resolved.
    expect(readMergeCommit("Merge branch 'main' into 'ABC-123-fix-login'", 'gitlab')).toEqual({
      number: null,
      branch: null,
    });
  });

  it('says nothing about an ordinary commit', () => {
    expect(readMergeCommit('feat(sources): collect on demand', 'github')).toEqual({
      number: null,
      branch: null,
    });
  });

  it('ignores a body quoting a merge: the subject is what describes the commit', () => {
    const message = ['fix: restore the cursor', '', 'Reverts Merge pull request #42 from acme/x'].join(
      '\n',
    );

    expect(readMergeCommit(message, 'github')).toEqual({ number: null, branch: null });
  });
});
