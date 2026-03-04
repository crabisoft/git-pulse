import { describe, expect, it } from 'vitest';
import type { Branch } from '@repo/shared';
import { candidateBranches, nearestBranch, NEAREST_CANDIDATES } from './nearest-branch';

function branch(name: string, isDefault = false): Branch {
  return { name, sha: `sha-${name}`, isDefault };
}

/** A branch and the commit it last shared with the deployed ref. */
function found(name: string, committedAt: string | null, isDefault = false) {
  return { branch: name, isDefault, base: { sha: `base-${name}`, committedAt } };
}

describe('candidateBranches', () => {
  it('never spends a call comparing the deployed ref against itself', () => {
    const candidates = candidateBranches(
      [branch('main', true), branch('release/2026.07.11')],
      'release/2026.07.11',
    );

    expect(candidates.map((c) => c.branch)).toEqual(['main']);
  });

  it('asks the default branch first, then the line the ref belongs to', () => {
    // The default branch is the answer whenever nothing closer is found, so it
    // is the one candidate the cap must never drop.
    const candidates = candidateBranches(
      [
        branch('feature/checkout-retry'),
        branch('release/2026.07.10'),
        branch('main', true),
        branch('release/2026.06.30'),
      ],
      'release/2026.07.11',
    );

    expect(candidates.map((c) => c.branch)).toEqual([
      'main',
      'release/2026.07.10',
      'release/2026.06.30',
      'feature/checkout-retry',
    ]);
  });

  it('caps what one resolution may cost', () => {
    const many = Array.from({ length: 40 }, (_, i) => branch(`feature/${i}`));

    expect(candidateBranches([branch('main', true), ...many], 'v2')).toHaveLength(
      NEAREST_CANDIDATES,
    );
  });

  it('keeps the order the platform listed them in, within a rank', () => {
    // Nothing here orders two feature branches, and inventing one would make a
    // run's answer depend on a sort nobody asked for.
    const candidates = candidateBranches([branch('b'), branch('a'), branch('c')], 'v2');

    expect(candidates.map((c) => c.branch)).toEqual(['b', 'a', 'c']);
  });
});

describe('nearestBranch', () => {
  it('takes the branch whose common commit is the youngest', () => {
    const picked = nearestBranch(
      [
        found('main', '2026-05-01T10:00:00Z', true),
        found('release/2026.07.10', '2026-07-09T18:00:00Z'),
      ],
      { sha: 'tip', committedAt: '2026-07-11T09:00:00Z' },
    );

    expect(picked).toBe('release/2026.07.10');
  });

  it('passes over a branch that already holds the ref', () => {
    // Its base is the ref's own tip: the comparison would be empty, which is
    // the state this is being asked to get out of.
    const picked = nearestBranch(
      [found('main', '2026-07-11T09:00:00Z', true), found('release/2026.07.10', '2026-07-09T18:00:00Z')],
      { sha: 'base-main', committedAt: '2026-07-11T09:00:00Z' },
    );

    expect(picked).toBe('release/2026.07.10');
  });

  it('leaves out a candidate the platform would not compare, and one it would not date', () => {
    const picked = nearestBranch(
      [
        { branch: 'gone', isDefault: false, base: null },
        found('undated', null),
        found('main', '2026-05-01T10:00:00Z', true),
      ],
      null,
    );

    expect(picked).toBe('main');
  });

  it('gives a tie to the default branch', () => {
    const picked = nearestBranch(
      [found('release/2026.07.10', '2026-07-09T18:00:00Z'), found('main', '2026-07-09T18:00:00Z', true)],
      null,
    );

    expect(picked).toBe('main');
  });

  it('says so when the history names no branch at all', () => {
    expect(nearestBranch([], null)).toBeNull();
    expect(nearestBranch([{ branch: 'gone', isDefault: false, base: null }], null)).toBeNull();
  });
});
