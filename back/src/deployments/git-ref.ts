/** Characters git itself forbids in a ref name — see git-check-ref-format. */
const FORBIDDEN = /[\s~^:?*[\\]/;

/**
 * Whether a string is usable as a git ref in a comparison.
 *
 * Permissive on purpose — a ref may be a tag, a branch with slashes in it, or a
 * commit sha, and the platform is the authority on what actually resolves. This
 * only rejects what cannot work or would change the shape of the request:
 *
 * - whitespace and the characters git forbids;
 * - `..`, git's own range separator — and `...` is what the compare endpoints
 *   are built around, so a ref carrying it would be read as a second bound
 *   rather than as part of the first;
 * - a leading dash, which a command line would read as an option.
 *
 * A dash is fine anywhere else: `v1.0-rc1` is an ordinary tag. A ref that
 * passes here and does not exist is the platform's answer to give, not ours to
 * predict.
 */
export function isValidGitRef(ref: string): boolean {
  if (ref.length === 0 || ref.length > 255) return false;
  if (ref.includes('..')) return false;
  if (ref.startsWith('-')) return false;
  return !FORBIDDEN.test(ref);
}
