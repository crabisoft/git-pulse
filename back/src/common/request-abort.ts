import { HttpException } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Status of a request the client gave up on. Not an IANA code — it is nginx's
 * "Client Closed Request", used here for the same reason: it stays out of the
 * 5xx bucket, so a cancellation is never logged or alerted on as a failure.
 */
export const CLIENT_CLOSED_REQUEST = 499;

/**
 * Signal aborted when the client hangs up before the response is written.
 *
 * `close` on the *response* is the unambiguous marker: it fires either once the
 * response is complete, or when the connection dropped early — `writableEnded`
 * tells the two apart. Watching the request instead would be fragile, its own
 * `close` semantics having shifted between Node versions.
 */
export function abortOnDisconnect(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

/**
 * Turns a cancellation into a response the filter can serialize — used where a
 * failure would otherwise be degraded into partial data. Once the caller has
 * hung up there is nothing to degrade into: the work has to stop, not carry on
 * with an empty list.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new HttpException({ code: 'errors.aborted' }, CLIENT_CLOSED_REQUEST);
  }
}

/**
 * True for the raw `AbortError` a signal throws — what surfaces when the
 * cancellation is noticed inside a connector rather than around an HTTP call.
 */
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}
