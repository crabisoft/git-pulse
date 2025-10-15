import { describe, expect, it } from 'vitest';
import { parseConventionalCommit, sectionRank } from './conventional-commit';

describe('parseConventionalCommit', () => {
  it('reads a type and a summary', () => {
    expect(parseConventionalCommit('feat: add the dashboard')).toEqual({
      type: 'feat',
      scope: null,
      breaking: false,
      summary: 'add the dashboard',
    });
  });

  it('reads a scope', () => {
    expect(parseConventionalCommit('fix(dora): clamp negative durations')).toMatchObject({
      type: 'fix',
      scope: 'dora',
      summary: 'clamp negative durations',
    });
  });

  it('lowercases the type, so one section does not become two', () => {
    expect(parseConventionalCommit('Feat: something')?.type).toBe('feat');
  });

  it('flags a breaking change marked with a bang', () => {
    expect(parseConventionalCommit('feat(api)!: drop the v1 routes')).toMatchObject({
      breaking: true,
      summary: 'drop the v1 routes',
    });
  });

  it('flags one marked by the footer, both spellings', () => {
    const dashed = parseConventionalCommit('feat: x\n\nBREAKING-CHANGE: the v1 routes are gone');
    const spaced = parseConventionalCommit('feat: x\n\nBREAKING CHANGE: the v1 routes are gone');
    expect(dashed?.breaking).toBe(true);
    expect(spaced?.breaking).toBe(true);
  });

  it('prefers the footer wording, written for whoever reads the notes', () => {
    const parsed = parseConventionalCommit('feat: rework auth\n\nBREAKING CHANGE: tokens must be reissued');
    expect(parsed?.summary).toBe('tokens must be reissued');
  });

  it('returns nothing for a message following no convention', () => {
    expect(parseConventionalCommit('Fix the login page')).toBeNull();
    expect(parseConventionalCommit('Merge branch main into feature')).toBeNull();
  });

  it('does not invent a type out of a colon in the middle of a subject', () => {
    // "Revert: fix login" would otherwise yield a type named `revert`.
    expect(parseConventionalCommit('Reverting this: fix login')).toBeNull();
  });

  it('needs a space after the colon, as the specification asks', () => {
    expect(parseConventionalCommit('feat:no space')).toBeNull();
  });

  it('treats an empty scope as none rather than as a blank one', () => {
    expect(parseConventionalCommit('feat(): x')?.scope).toBeNull();
  });

  it('keeps only the subject, the body being for the reviewer', () => {
    const parsed = parseConventionalCommit('fix: one line\n\nA long explanation.\nAnd another.');
    expect(parsed?.summary).toBe('one line');
  });
});

describe('sectionRank', () => {
  it('leads with what a reader looks for first', () => {
    expect(sectionRank('feat')).toBeLessThan(sectionRank('fix'));
    expect(sectionRank('fix')).toBeLessThan(sectionRank('chore'));
  });

  it('files an unknown type after the known ones but before the unparsed', () => {
    expect(sectionRank('chore')).toBeLessThan(sectionRank('wip'));
    expect(sectionRank('wip')).toBeLessThan(sectionRank('other'));
  });
});
