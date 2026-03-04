import { describe, expect, it } from 'vitest';
import { refUrl, repoUrl, requestUrl, type RepoLocation } from './ref-url';

const GITHUB: RepoLocation = {
  kind: 'github',
  baseUrl: 'https://api.github.com',
  owner: 'acme',
  repo: 'portal-api',
};
const GHE: RepoLocation = { ...GITHUB, baseUrl: 'https://github.acme.internal/' };
const GITLAB: RepoLocation = {
  kind: 'gitlab',
  baseUrl: 'https://gitlab.example.com/',
  owner: 'acme',
  repo: 'acme/sub/portal-api',
};

describe('repoUrl', () => {
  it('sends github.com to the web host, not the API one', () => {
    expect(repoUrl(GITHUB)).toBe('https://github.com/acme/portal-api');
  });

  it('keeps an Enterprise install on its own root', () => {
    // One host serves both there, so the public special case must not apply.
    expect(repoUrl(GHE)).toBe('https://github.acme.internal/acme/portal-api');
  });

  it('leaves the owner out on GitLab, whose repo path already carries it', () => {
    expect(repoUrl(GITLAB)).toBe('https://gitlab.example.com/acme/sub/portal-api');
  });
});

describe('refUrl', () => {
  it('uses one shape for a branch, a tag and a commit', () => {
    // Both platforms resolve `tree/<ref>` against whichever it turns out to be,
    // so nothing has to guess what the caller is holding.
    for (const ref of ['main', 'v2.1.0', '3f2a91c8e4d5b6a7f8091a2b3c4d5e6f70819a2b']) {
      expect(refUrl(GITHUB, ref)).toBe(`https://github.com/acme/portal-api/tree/${ref}`);
    }
  });

  it('inserts the segment GitLab requires', () => {
    expect(refUrl(GITLAB, 'main')).toBe(
      'https://gitlab.example.com/acme/sub/portal-api/-/tree/main',
    );
  });

  it('keeps a slash in a ref as a separator rather than escaping it', () => {
    // `release/3.0` is one ref, and both platforms expect it spelled that way.
    expect(refUrl(GITHUB, 'release/3.0')).toBe(
      'https://github.com/acme/portal-api/tree/release/3.0',
    );
  });

  it('escapes what is not a separator', () => {
    expect(refUrl(GITHUB, 'fix/a b')).toBe('https://github.com/acme/portal-api/tree/fix/a%20b');
  });
});

describe('requestUrl', () => {
  it('names a pull request the way GitHub does', () => {
    expect(requestUrl(GITHUB, 42)).toBe('https://github.com/acme/portal-api/pull/42');
  });

  it('names a merge request the way GitLab does', () => {
    expect(requestUrl(GITLAB, 42)).toBe(
      'https://gitlab.example.com/acme/sub/portal-api/-/merge_requests/42',
    );
  });
});
