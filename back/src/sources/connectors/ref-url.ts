import type { SourceKind } from '@repo/shared';

/** What a platform's web URLs are built from. Never a credential. */
export interface RepoLocation {
  kind: SourceKind;
  /** The source's base URL, as configured. */
  baseUrl: string;
  /** Org or group root — the source's scope owner. */
  owner: string;
  repo: string;
}

/**
 * Web page of a repository.
 *
 * GitHub's base URL is an API host (`api.github.com` on the public instance),
 * so the public case is special-cased; an Enterprise install serves both from
 * the same root. GitLab's repo path already carries its group, which is why the
 * owner does not appear there.
 */
export function repoUrl({ kind, baseUrl, owner, repo }: RepoLocation): string {
  const root = baseUrl.replace(/\/+$/, '');
  if (kind === 'gitlab') return `${root}/${repo}`;
  const isDotCom = /(^|\/\/)(www\.|api\.)?github\.com/.test(baseUrl);
  return `${isDotCom ? 'https://github.com' : root}/${owner}/${repo}`;
}

/**
 * Web page of a ref — a branch, a tag or a commit.
 *
 * One shape for all three: both platforms resolve `tree/<ref>` against whichever
 * it turns out to be, so nothing here has to guess what a caller is holding. A
 * sha lands on the tree at that commit rather than on its diff, which is the
 * lesser of the two wrongs — guessing wrong about a branch named like a sha
 * would produce a link that resolves to nothing.
 *
 * Unlike an environment's address, this **is** derivable: the platform, the base
 * URL, the owner and the repo are all in hand, so it is built rather than read.
 */
export function refUrl(location: RepoLocation, ref: string): string {
  const root = repoUrl(location);
  // `release/3.0` is one ref, not two path segments — but the slash is a
  // separator the platforms expect, so only the rest is escaped.
  const path = ref.split('/').map(encodeURIComponent).join('/');
  return location.kind === 'gitlab' ? `${root}/-/tree/${path}` : `${root}/tree/${path}`;
}
