import { describe, expect, it } from 'vitest';
import type { Tag } from '@repo/shared';
import { byTagDate } from './tag-order';

function tag(name: string, taggedAt: string | null): Tag {
  return { name, sha: name, taggedAt };
}

describe('byTagDate', () => {
  it('puts the newest first', () => {
    const sorted = byTagDate([
      tag('v1.0.0', '2026-01-10T00:00:00Z'),
      tag('v1.2.0', '2026-03-10T00:00:00Z'),
      tag('v1.1.0', '2026-02-10T00:00:00Z'),
    ]);
    expect(sorted.map((t) => t.name)).toEqual(['v1.2.0', 'v1.1.0', 'v1.0.0']);
  });

  it('orders ten after nine, which is where a name sort goes wrong', () => {
    // The whole reason this exists. `resolveRange` reads the tag below one as
    // its predecessor, so sorted by name the release note for v1.10.0 would
    // report the range since v1.9.0 — and every link in it would resolve.
    const sorted = byTagDate([
      tag('v1.9.0', '2026-05-01T00:00:00Z'),
      tag('v1.10.0', '2026-06-01T00:00:00Z'),
    ]);
    expect(sorted.map((t) => t.name)).toEqual(['v1.10.0', 'v1.9.0']);
  });

  it('orders names no comparison of strings could', () => {
    // A repository tags what it likes. Dates order these; nothing else does.
    const sorted = byTagDate([
      tag('hotfix', '2026-07-02T00:00:00Z'),
      tag('2026.07', '2026-07-01T00:00:00Z'),
      tag('release-3', '2026-07-03T00:00:00Z'),
    ]);
    expect(sorted.map((t) => t.name)).toEqual(['release-3', 'hotfix', '2026.07']);
  });

  it('keeps an undated tag after every dated one, in the order it came', () => {
    // A lightweight tag whose date could not be read. Guessing where it belongs
    // would invent the very thing this function exists to stop inventing.
    const sorted = byTagDate([
      tag('nightly', null),
      tag('v2.0.0', '2026-04-01T00:00:00Z'),
      tag('scratch', null),
      tag('v3.0.0', '2026-05-01T00:00:00Z'),
    ]);
    expect(sorted.map((t) => t.name)).toEqual(['v3.0.0', 'v2.0.0', 'nightly', 'scratch']);
  });

  it('leaves the list it was handed alone', () => {
    const tags = [tag('a', '2026-01-01T00:00:00Z'), tag('b', '2026-02-01T00:00:00Z')];
    byTagDate(tags);
    expect(tags.map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('has nothing to say about an empty list', () => {
    expect(byTagDate([])).toEqual([]);
  });
});
