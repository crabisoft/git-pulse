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
    pullRequest: null,
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

  it('links commits and the comparison on the repo web URL', async () => {
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', ENTRIES);

    expect(markdown).toContain('https://github.com/acme/widget/commit/aaaaaaaaaaaaaaa');
    expect(markdown).toContain('https://github.com/acme/widget/compare/v1.0.0...v1.1.0');
  });

  it('hangs the same pages off the paths GitLab uses', async () => {
    const markdown = await renderChangelog(GITLAB, 'v1.0.0', 'v1.1.0', ENTRIES);

    expect(markdown).toContain('https://gitlab.acme.io/group/widget/-/commit/aaaaaaaaaaaaaaa');
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

describe('renderChangelog and the trackers', () => {
  /** An entry carrying what the ticket rules found on it. */
  function tracked(sha: string, message: string, tickets: ReleaseNoteEntry['tickets']) {
    return { ...entry(sha, message), tickets };
  }

  const jira = (key: string) => ({
    key,
    url: `https://jira.acme.io/browse/${key}`,
    foundIn: 'title' as const,
    tracker: { id: 'tr-1', name: 'Jira', kind: 'jira' as const },
  });

  it('links a tracker key the preset knows nothing about', async () => {
    // The preset links `#12` to this repository's issues. A Jira key is not an
    // issue of this repository, and no template it expands can reach one.
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', [
      tracked('aaaaaaaaaaaaaaa', 'fix(auth): reset a password, OPS-123', [jira('OPS-123')]),
    ]);

    expect(markdown).toContain('[OPS-123](https://jira.acme.io/browse/OPS-123)');
  });

  it('unlinks a reference no rule claims, rather than guessing where it lives', async () => {
    // The preset sends every `#12` to this repository's issues, which is a
    // guess about a team that may file nowhere near it. The rules answer that
    // question, so a reference none of them claims is left as written.
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', [
      tracked('aaaaaaaaaaaaaaa', 'feat(sources): collect on demand\n\nCloses #12', [jira('OPS-7')]),
      tracked('bbbbbbbbbbbbbbb', 'fix(api): drop nothing, OPS-7', [jira('OPS-7')]),
    ]);

    expect(markdown).not.toContain('/issues/12');
    expect(markdown).toContain('#12');
    expect(markdown).toContain('[OPS-7](https://jira.acme.io/browse/OPS-7)');
  });

  it("sends a reference a rule claims to that rule's tracker instead", async () => {
    // The case the whole thing is for: `#12` belongs to a tracker that is not
    // this repository, and the rule is what says so.
    const github = {
      key: '#12',
      url: 'https://github.com/acme/backlog/issues/12',
      foundIn: 'commit' as const,
      tracker: { id: 'tr-2', name: 'Backlog', kind: 'github' as const },
    };
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', [
      tracked('aaaaaaaaaaaaaaa', 'feat(sources): collect on demand\n\nCloses #12', [github]),
    ]);

    expect(markdown).toContain('[#12](https://github.com/acme/backlog/issues/12)');
    expect(markdown).not.toContain('widget/issues/12');
  });

  it('keeps the link of a request the range itself carries', async () => {
    // `(#42)` in a squashed subject is the pull request the change landed in,
    // not an issue anybody filed: the entry already knows where it lives.
    const squash = {
      ...tracked('aaaaaaaaaaaaaaa', 'feat(sources): collect on demand (#42)', []),
      pullRequest: {
        number: 42,
        url: 'https://github.com/acme/widget/pull/42',
      },
    };
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', [squash]);

    expect(markdown).toContain('[#42](https://github.com/acme/widget/pull/42)');
  });

  it('names a ticket the rendered text never held', async () => {
    // The whole gap this closes: the rules read `OPS-9` off a branch name, and
    // this generator renders the commit message, where it does not appear. A
    // reference found and then dropped is worse than one never looked for.
    const branchOnly = {
      ...tracked('aaaaaaaaaaaaaaa', 'feat(auth): reset a password', [jira('OPS-9')]),
      tickets: [{ ...jira('OPS-9'), foundIn: 'branch' as const }],
    };
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', [branchOnly]);

    expect(markdown).toContain(
      'reset a password ([aaaaaaa](https://github.com/acme/widget/commit/aaaaaaaaaaaaaaa)), ' +
        '[OPS-9](https://jira.acme.io/browse/OPS-9)',
    );
  });

  it('does not name one the line already carries', async () => {
    // Linked in place by the pass above; naming it again would read as two
    // tickets where there is one.
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', [
      tracked('aaaaaaaaaaaaaaa', 'fix(api): OPS-4 stop dropping the cursor', [jira('OPS-4')]),
    ]);

    expect(markdown.match(/OPS-4/g)).toHaveLength(2); // the link's text and its href
  });

  it('names the tickets of a commit on that commit line alone', async () => {
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', [
      tracked('aaaaaaaaaaaaaaa', 'feat(auth): reset a password', [jira('OPS-9')]),
      tracked('bbbbbbbbbbbbbbb', 'fix(api): stop dropping the cursor', [jira('OPS-4')]),
    ]);

    const feature = markdown.split('\n').find((l) => l.includes('reset a password')) ?? '';
    const fix = markdown.split('\n').find((l) => l.includes('dropping the cursor')) ?? '';
    expect(feature).toContain('OPS-9');
    expect(feature).not.toContain('OPS-4');
    expect(fix).toContain('OPS-4');
  });

  it('names a ticket that resolved to no URL, the key being what one searches', async () => {
    const keyOnly = {
      key: 'OPS-3',
      foundIn: 'branch' as const,
      tracker: { id: 'tr-1', name: 'Jira', kind: 'jira' as const },
    };
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', [
      tracked('aaaaaaaaaaaaaaa', 'feat(auth): reset a password', [keyOnly]),
    ]);

    expect(markdown).toContain('), OPS-3');
    expect(markdown).not.toContain('[OPS-3](');
  });

  it('leaves a commit carrying no ticket exactly as the package wrote it', async () => {
    const markdown = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', [
      tracked('aaaaaaaaaaaaaaa', 'chore: bump the lockfile', []),
    ]);

    expect(markdown).toContain(
      'bump the lockfile ([aaaaaaa](https://github.com/acme/widget/commit/aaaaaaaaaaaaaaa))\n',
    );
  });

  it('changes nothing when no rule matched anything', async () => {
    const plain = await renderChangelog(GITHUB, 'v1.0.0', 'v1.1.0', ENTRIES);
    expect(plain).toContain('collect on demand');
    expect(plain).not.toContain('](https://jira');
  });
});
