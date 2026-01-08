import { HttpStatus } from '@nestjs/common';
import { CodedException } from '../../common/coded-exception';

/**
 * A range the platform will not resolve, reported as an answer rather than a
 * fault.
 *
 * It is the ordinary end of a deployed ref: branches are deleted on merge,
 * tags are moved, commits are pruned with the fork they lived on — and the
 * compare endpoint then answers 404 for a deployment that really did happen.
 * Left raw it surfaces as an internal error, which says the install is broken
 * when what is broken is nothing: the history simply no longer exists to be
 * read. Which is what the changelog archive is written for.
 */
export function unresolvableRange(repo: string, from: string | null, to: string): CodedException {
  // Two codes rather than one with an empty bound: without a lower bound there
  // is no range to speak of, and the 404 is about the single ref that was
  // walked. A message reading "…v2.0.0 cannot be compared" would name a bound
  // nobody asked for.
  return from === null || from === ''
    ? new CodedException('errors.compare.unknownRef', HttpStatus.NOT_FOUND, { repo, ref: to })
    : new CodedException('errors.compare.unresolvable', HttpStatus.NOT_FOUND, { repo, from, to });
}

/**
 * Whether a platform client refused with a 404.
 *
 * Both shapes are read because both clients are used: Octokit puts the status
 * on the error, gitbeaker keeps the response under `cause`. Neither is worth a
 * dependency on the client's error class — a number in one of two places is the
 * whole of what has to be recognised.
 */
export function isNotFound(e: unknown): boolean {
  const error = e as { status?: number; cause?: { response?: { status?: number } } };
  return error?.status === 404 || error?.cause?.response?.status === 404;
}
