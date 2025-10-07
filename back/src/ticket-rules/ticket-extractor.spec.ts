import { describe, expect, it } from 'vitest';
import { extractTickets, type TicketRuleLike, type TicketRuleTracker } from './ticket-extractor';

const tracker = (over: Partial<TicketRuleTracker> = {}): TicketRuleTracker => ({
  id: 'jira-1',
  name: 'Jira',
  kind: 'jira',
  baseUrl: 'https://acme.atlassian.net',
  urlTemplate: null,
  ...over,
});

const rule = (pattern: string, over: Partial<TicketRuleLike> = {}): TicketRuleLike => ({
  name: 'rule',
  pattern,
  priority: 10,
  tracker: tracker(),
  ...over,
});

const JIRA = rule('(?<key>[A-Z]{2,5}-\\d+)');
const GITHUB = rule('#(?<key>\\d+)', {
  priority: 50,
  tracker: tracker({ id: 'gh-1', name: 'Issues', kind: 'github', baseUrl: 'https://github.com' }),
});

const found = (branch: string, title: string, rules: TicketRuleLike[] = [JIRA, GITHUB]) =>
  extractTickets({ branch, title }, rules).map((r) => `${r.tracker.kind}:${r.key}:${r.foundIn}`);

describe('extractTickets', () => {
  it('reads the branch and the title', () => {
    expect(found('feature/OPS-1-login', '')).toEqual(['jira:OPS-1:branch']);
    expect(found('', 'OPS-1 fix login')).toEqual(['jira:OPS-1:title']);
  });

  it('keeps a key found in both, attributed to the branch', () => {
    expect(found('feature/OPS-123-login', 'OPS-123 fix login')).toEqual(['jira:OPS-123:branch']);
  });

  it('returns every ticket a text references, not just the first', () => {
    expect(found('', 'OPS-123 and OPS-124 together')).toEqual([
      'jira:OPS-123:title',
      'jira:OPS-124:title',
    ]);
  });

  it('returns them in discovery order, so the main ticket comes first', () => {
    // Sorting by key would have put the `#42` in front of the branch's OPS-9.
    expect(found('fix/OPS-9', 'closes #42')).toEqual(['jira:OPS-9:branch', 'github:42:title']);
  });

  it('lets the lower priority number claim a contested key', () => {
    const contested = rule('(?<key>AB-\\d+)', {
      priority: 5,
      tracker: tracker({ id: 'linear-1', name: 'Linear', kind: 'linear' }),
    });
    expect(found('', 'AB-1', [contested, rule('(?<key>AB-\\d+)', { priority: 10 })])).toEqual([
      'linear:AB-1:title',
    ]);
  });

  it('falls back to the whole match when the pattern names no group', () => {
    expect(found('', 'OPS-1', [rule('[A-Z]{2,5}-\\d+')])).toEqual(['jira:OPS-1:title']);
  });

  it('skips an invalid pattern instead of throwing', () => {
    expect(found('OPS-1', '', [rule('(['), JIRA])).toEqual(['jira:OPS-1:branch']);
  });

  it('finds nothing in a branch that references nothing', () => {
    expect(found('chore/bump-deps', 'Bump deps')).toEqual([]);
  });

  it('also eats what a loose pattern happens to match — hence the rule tester', () => {
    expect(found('', 'switch to UTF-8', [JIRA])).toEqual(['jira:UTF-8:title']);
  });
});

describe('link building', () => {
  const urls = (branch: string, rules: TicketRuleLike[], origin?: { owner: string; repo: string }) =>
    extractTickets({ branch, title: '' }, rules, origin).map((r) => r.url ?? null);

  it('derives the link from the tracker kind', () => {
    expect(urls('f/OPS-1', [JIRA])).toEqual(['https://acme.atlassian.net/browse/OPS-1']);
    const linear = rule('(?<key>ENG-\\d+)', {
      tracker: tracker({ kind: 'linear', baseUrl: 'https://linear.app/acme' }),
    });
    expect(urls('f/ENG-7', [linear])).toEqual(['https://linear.app/acme/issue/ENG-7']);
  });

  it('drops a trailing slash on the base URL', () => {
    const trailing = rule('(?<key>[A-Z]+-\\d+)', {
      tracker: tracker({ baseUrl: 'https://acme.atlassian.net/' }),
    });
    expect(urls('f/OPS-1', [trailing])).toEqual(['https://acme.atlassian.net/browse/OPS-1']);
  });

  it('prefers an explicit template over the kind default', () => {
    const custom = rule('(?<key>[A-Z]+-\\d+)', {
      tracker: tracker({ urlTemplate: '{base}/t/{key}' }),
    });
    expect(urls('f/OPS-1', [custom])).toEqual(['https://acme.atlassian.net/t/OPS-1']);
  });

  it('resolves the repository per pull request', () => {
    expect(urls('f/#42', [GITHUB], { owner: 'acme', repo: 'api' })).toEqual([
      'https://github.com/acme/api/issues/42',
    ]);
  });

  it('keeps the slashes of a nested group, which are path separators', () => {
    const gitlab = rule('#(?<key>\\d+)', {
      tracker: tracker({ kind: 'gitlab', baseUrl: 'https://gitlab.acme.io' }),
    });
    expect(urls('f/#42', [gitlab], { owner: 'grp', repo: 'grp/sub/api' })).toEqual([
      'https://gitlab.acme.io/grp/sub/api/-/issues/42',
    ]);
  });

  it('returns no link rather than one with a hole in it', () => {
    // A repo-dependent template outside any pull request context.
    expect(urls('f/#42', [GITHUB])).toEqual([null]);
  });

  it('carries the tracker along for display', () => {
    const [ref] = extractTickets({ branch: 'f/OPS-1', title: '' }, [JIRA]);
    expect(ref.tracker).toEqual({ id: 'jira-1', name: 'Jira', kind: 'jira' });
  });
});
