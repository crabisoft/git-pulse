import { describe, expect, it } from 'vitest';
import type { ReleaseNoteEntry } from '@repo/shared';
import type { RepoLocation } from '../sources/connectors/ref-url';
import { renderChangelog } from './changelog';

const GITHUB: RepoLocation = {
  kind: 'github',
  baseUrl: 'https://api.github.com',
  owner: 'acme',
  repo: 'widget',
};

const GITLAB: RepoLocation = {
  kind: 'gitlab',
  baseUrl: 'https://gitlab.acme.io',
  owner: 'acme',
  repo: 'group/widget',
};

/** Only `message` and `sha` reach the package; the rest is the page's reading. */
function entry(sha: string, message: string): ReleaseNoteEntry {
  return {
    summary: message.split('\n')[0],
    message,
    scope: null,
    breaking: false,
    sha,
    author: 'Ada',
    url: `https://example.invalid/${sha}`,
    tickets: [],
  };
}

const ENTRIES = [
  entry('aaaaaaaaaaaaaaa', 'feat(sources): collect on demand\n\nCloses #12'),
  entry('bbbbbbbbbbbbbbb', 'fix(api): stop dropping the cursor'),
  entry('ccccccccccccccc', 'refactor(dora): lift the period out'),
  entry('ddddddddddddddd', 'perf!: halve the query count'),
  entry('eeeeeeeeeeeeeee', 'merge branch main into release'),
];

describe('renderChangelog', () => {
  it("groups commits under the preset's section titles", async () => {
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', ENTRIES);

    expect(markdown).toContain('### Features');
    expect(markdown).toContain('### Bug Fixes');
    expect(markdown).toContain('collect on demand');
  });

  it('publishes the types the preset hides, so no commit is lost to a section', async () => {
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', ENTRIES);

    expect(markdown).toContain('### Code Refactoring');
    expect(markdown).toContain('lift the period out');
  });

  it('leads with the breaking changes a `!` marks', async () => {
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', ENTRIES);
    const breaking = markdown.indexOf('BREAKING CHANGES');

    expect(breaking).toBeGreaterThan(-1);
    expect(breaking).toBeLessThan(markdown.indexOf('### Features'));
  });

  it('drops what follows no convention — the trade-off this generator is', async () => {
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', ENTRIES);

    expect(markdown).not.toContain('merge branch main');
  });

  it('links commits, references and the comparison on the repo web URL', async () => {
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', ENTRIES);

    expect(markdown).toContain('https://github.com/acme/widget/commit/aaaaaaaaaaaaaaa');
    expect(markdown).toContain('https://github.com/acme/widget/issues/12');
    expect(markdown).toContain('https://github.com/acme/widget/compare/v1.0.0...v1.1.0');
  });

  it('hangs the same pages off the paths GitLab uses', async () => {
    const markdown = await renderChangelog(GITLAB, 'v1.0.0', 'v1.1.0', ENTRIES);

    expect(markdown).toContain('https://gitlab.acme.io/group/widget/-/commit/aaaaaaaaaaaaaaa');
    expect(markdown).toContain('https://gitlab.acme.io/group/widget/-/issues/12');
    expect(markdown).toContain('https://gitlab.acme.io/group/widget/-/compare/v1.0.0...v1.1.0');
  });

  it('names the upper bound without a comparison link when the range is open', async () => {
    const markdown = await renderChangelog(GITHUB, null, 'v1.1.0', ENTRIES);

    expect(markdown).toContain('## v1.1.0');
    expect(markdown).not.toContain('/compare/');
  });

  it('renders a range holding nothing rather than failing on it', async () => {
    await expect(renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', [])).resolves.toContain('v1.1.0');
  });
});
