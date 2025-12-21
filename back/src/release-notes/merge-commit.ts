/**
 * What a merge commit says about the request that produced it.
 *
 * A commit title carries the ticket only when whoever wrote it put it there;
 * the branch it came in on carries it far more reliably, because that is what
 * the ticket rules were written against — and the request number is the link a
 * reader follows to see the review. The platforms write both into the merge
 * commit they generate, so for the commits that have one they can be read for
 * free: no call, no association to resolve.
 */

/**
 * GitHub's generated merge commit: `Merge pull request #42 from acme/topic`.
 * The head is `owner/branch`, and the owner is a fork's as readily as the
 * repo's, so only the first segment is dropped — a `feature/ABC-1` keeps its
 * own slash.
 */
const GITHUB_MERGE = /^Merge pull request #(?<number>\d+) from (?<head>\S+)/;

/**
 * GitHub's squashed commit, whose subject ends in the request number. Nothing
 * else about the request survives a squash — the branch is gone with the
 * commits it held.
 */
const GITHUB_SQUASH = /\(#(?<number>\d+)\)$/;

/** GitLab's: the branch is in the subject, the merge request in the footer. */
const GITLAB_MERGE = /^Merge branch '(?<head>[^']+)' into /;
const GITLAB_FOOTER = /^See merge request \S+!(?<number>\d+)$/m;

/** What a commit message gave up, each part absent on its own. */
export interface MergeCommitRef {
  /** The pull/merge request number. */
  number: number | null;
  /** The source branch. */
  branch: string | null;
}

const NOTHING: MergeCommitRef = { number: null, branch: null };

/**
 * Reads what a merge commit message says about its request. Both parts are null
 * for the many commits that are not one.
 *
 * The GitLab shape is only trusted when the merge request footer is there too.
 * `Merge branch 'main' into 'feature/x'` is what a developer catching up with
 * the default branch produces, and it names the branch that was merged *in*:
 * reading it would attribute `main`'s tickets, and worse, would stop the branch
 * from being resolved properly. Absent the footer, the caller is better served
 * by a null it can go and resolve.
 *
 * The squashed shape needs the platform, and gets it: `(#42)` closing a subject
 * is GitHub's own convention, where on GitLab a `#42` is an issue and reading
 * it as a merge request would link to the wrong page entirely.
 */
export function readMergeCommit(message: string, kind: string): MergeCommitRef {
  // Three of the four shapes live in the subject; matching them against the
  // whole message would let a body quoting a merge speak for the commit.
  const subject = message.split('\n')[0].trim();

  const merge = GITHUB_MERGE.exec(subject);
  if (merge?.groups) {
    const [, ...branch] = merge.groups.head.split('/');
    return {
      number: Number(merge.groups.number),
      branch: branch.length > 0 ? branch.join('/') : null,
    };
  }

  const footer = GITLAB_FOOTER.exec(message);
  if (footer?.groups) {
    return {
      number: Number(footer.groups.number),
      branch: GITLAB_MERGE.exec(subject)?.groups?.head ?? null,
    };
  }

  if (kind !== 'github') return NOTHING;
  const squash = GITHUB_SQUASH.exec(subject);
  return squash?.groups ? { number: Number(squash.groups.number), branch: null } : NOTHING;
}
