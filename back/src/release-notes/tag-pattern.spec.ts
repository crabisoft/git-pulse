import { describe, expect, it } from 'vitest';
import type { Tag } from '@repo/shared';
import { resolveRange, tagsMatching } from './range';

/** A monorepo's tags, newest first, as either platform answers them. */
const TAGS: Tag[] = [
  { name: 'api@3.0.1', sha: 'a1', taggedAt: '2026-03-04T00:00:00Z' },
  { name: 'front@1.3.0', sha: 'f3', taggedAt: '2026-03-01T00:00:00Z' },
  { name: 'api@3.0.0', sha: 'a0', taggedAt: '2026-02-20T00:00:00Z' },
  { name: 'front@1.2.0', sha: 'f2', taggedAt: '2026-02-10T00:00:00Z' },
];

const defaultBranch = () => Promise.resolve('main');

describe('picking the releases of one component out of a repo that holds several', () => {
  it('keeps every tag while no component is named', () => {
    expect(tagsMatching(TAGS, undefined)).toEqual(TAGS);
  });

  it('keeps the tags of the named component, in the order they came', () => {
    expect(tagsMatching(TAGS, '^front@').map((tag) => tag.name)).toEqual([
      'front@1.3.0',
      'front@1.2.0',
    ]);
  });

  it('filters nothing on a pattern the engine cannot read', () => {
    // The bound is a note somebody is waiting on. Refusing the typo is the
    // door's job; here, answering about the whole repo beats answering nothing.
    expect(tagsMatching(TAGS, '^front@(')).toEqual(TAGS);
  });

  it('answers an unreleased component with no tag rather than another’s', () => {
    expect(tagsMatching(TAGS, '^worker@')).toEqual([]);
  });
});

describe('the range those tags resolve to', () => {
  it('spans another component’s release when nothing narrows the tags', async () => {
    const range = await resolveRange({}, TAGS, defaultBranch);

    // The whole failure in one assertion: the front-end release in between is
    // never mentioned, and the range is read as if it were the API's alone.
    expect(range).toEqual({ from: 'front@1.3.0', to: 'api@3.0.1' });
  });

  it('spans the component’s own two releases once they are named', async () => {
    const range = await resolveRange({}, tagsMatching(TAGS, '^front@'), defaultBranch);

    expect(range).toEqual({ from: 'front@1.2.0', to: 'front@1.3.0' });
  });

  it('falls back to the default branch for a component that never released', async () => {
    const range = await resolveRange({}, tagsMatching(TAGS, '^worker@'), defaultBranch);

    expect(range).toEqual({ from: null, to: 'main' });
  });
});
