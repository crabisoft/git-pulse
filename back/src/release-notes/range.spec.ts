import { describe, expect, it, vi } from 'vitest';
import type { Tag } from '@repo/shared';
import { resolveRange } from './range';

const tag = (name: string): Tag => ({ name, sha: name, taggedAt: null });
/** Most recent first, as every connector returns them. */
const TAGS = [tag('v2.1.0'), tag('v2.0.0'), tag('v1.9.0')];

const branch = () => Promise.resolve('main');

describe('resolveRange', () => {
  it('summarises the last release when neither bound is given', async () => {
    expect(await resolveRange({}, TAGS, branch)).toEqual({ from: 'v2.0.0', to: 'v2.1.0' });
  });

  it('takes the tag below the one asked for', async () => {
    expect(await resolveRange({ to: 'v2.0.0' }, TAGS, branch)).toEqual({
      from: 'v1.9.0',
      to: 'v2.0.0',
    });
  });

  it('runs from the beginning of history for the oldest tag', async () => {
    expect(await resolveRange({ to: 'v1.9.0' }, TAGS, branch)).toEqual({
      from: null,
      to: 'v1.9.0',
    });
  });

  it('starts a branch at the most recent tag, not at the beginning of history', async () => {
    // "Everything on main since the last release" is the question a branch as
    // an upper bound is asking. Walking the whole history would answer another.
    expect(await resolveRange({ to: 'main' }, TAGS, branch)).toEqual({
      from: 'v2.1.0',
      to: 'main',
    });
  });

  it('compares two refs of any kind when both are given', async () => {
    expect(await resolveRange({ from: 'v2.1.0', to: 'release/3.0' }, TAGS, branch)).toEqual({
      from: 'v2.1.0',
      to: 'release/3.0',
    });
  });

  it('falls back to the default branch when the repo has no tag', async () => {
    expect(await resolveRange({}, [], branch)).toEqual({ from: null, to: 'main' });
  });

  it('does not ask for the default branch when a bound already names one', async () => {
    // It costs a call, and a stated upper bound has already answered it.
    const defaultBranch = vi.fn(branch);
    await resolveRange({ to: 'develop' }, TAGS, defaultBranch);
    expect(defaultBranch).not.toHaveBeenCalled();
  });
});
