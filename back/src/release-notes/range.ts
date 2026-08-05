import type { Tag } from '@repo/shared';

/** The bounds as asked for, either of which may be missing. */
export interface RangeQuery {
  from?: string;
  to?: string;
}

/** The bounds actually used. `from` null means "from the beginning of history". */
export interface ResolvedRange {
  from: string | null;
  to: string;
}

/**
 * The tags of one component, out of a repo that releases several.
 *
 * A monorepo tags per deployable, so its tags interleave — `front@1.2.0`,
 * `api@3.0.1`, `front@1.3.0`. Every default below reads "the most recent tag"
 * and "the tag just below it", which on such a list means whichever component
 * happened to release last: a range that starts at another deployable's
 * release, and a note listing commits nobody asked about.
 *
 * An unreadable pattern filters nothing rather than throwing. The bound it
 * would produce is a release note somebody is waiting on, and a note over the
 * whole repo is a legible answer where an error is not — the pattern is
 * validated at the door, where a typo can still be pointed at.
 */
export function tagsMatching(tags: Tag[], pattern: string | undefined): Tag[] {
  if (!pattern) return tags;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return tags;
  }
  const kept = tags.filter((tag) => regex.test(tag.name));
  // A pattern matching nothing is a pattern about a component that has never
  // been released. Keeping the unfiltered list would silently answer about
  // another one, so the emptiness is passed on: no tag, hence the default
  // branch and the whole history, which is what a first release is.
  return kept;
}

/**
 * Fills the bounds in. A bound is a **ref** — a tag or a branch — because that
 * is what the platforms compare; the defaults below are what a release note
 * usually wants when neither is stated.
 *
 * `to` defaults to the most recent tag, so a release is summarised as it was
 * cut rather than as the branch has drifted since. With no tag at all it falls
 * back to the default branch, which is what a first release needs.
 *
 * `from` defaults to the tag just below `to` in the platform's own ordering.
 * When `to` is **not** a tag — a branch, or a sha — there is no "below" to find,
 * and the most recent tag is used instead: "everything on this branch since the
 * last release" is exactly the question being asked.
 */
export async function resolveRange(
  query: RangeQuery,
  tags: Tag[],
  defaultBranch: () => Promise<string>,
): Promise<ResolvedRange> {
  const to = query.to ?? tags[0]?.name ?? (await defaultBranch());
  if (query.from) return { from: query.from, to };

  const index = tags.findIndex((tag) => tag.name === to);
  const previous = index === -1 ? tags[0] : tags[index + 1];
  return { from: previous?.name ?? null, to };
}
