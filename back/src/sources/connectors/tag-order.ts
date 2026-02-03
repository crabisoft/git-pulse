import type { Tag } from '@repo/shared';

/**
 * Tags, newest first.
 *
 * The order is not decoration: `resolveRange` reads "the tag below this one" as
 * the previous release, so a list sorted by name makes `v1.9.0` the predecessor
 * of `v1.10.0` and a release note reports the wrong range — quietly, and with
 * every link in it pointing somewhere plausible.
 *
 * Names cannot be trusted to give the order either. A repository is free to tag
 * `2026.07`, `release-3`, `hotfix`, or all three, and no comparison of strings
 * orders those the way the history does. The date the tag points at is the only
 * thing that does.
 *
 * A tag with no date keeps the order the platform listed it in, after every
 * dated one: it is a lightweight tag whose date could not be read, and guessing
 * where it belongs would be inventing the very thing this exists to avoid.
 */
export function byTagDate(tags: readonly Tag[]): Tag[] {
  const dated = tags.filter((tag) => tag.taggedAt !== null);
  const undated = tags.filter((tag) => tag.taggedAt === null);
  dated.sort((a, b) => Date.parse(b.taggedAt!) - Date.parse(a.taggedAt!));
  return [...dated, ...undated];
}
