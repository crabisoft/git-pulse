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
