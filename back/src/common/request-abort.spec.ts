import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { CLIENT_CLOSED_REQUEST, isAbortError, throwIfAborted } from './request-abort';

describe('throwIfAborted', () => {
  it('does nothing while the caller is still listening', () => {
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  it('answers 499 once the caller has hung up, out of the 5xx the filter logs', () => {
    const controller = new AbortController();
    controller.abort();

    try {
      throwIfAborted(controller.signal);
      expect.unreachable('a cancelled request must not carry on');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(CLIENT_CLOSED_REQUEST);
      expect((e as HttpException).getResponse()).toEqual({ code: 'errors.aborted' });
    }
  });
});

describe('isAbortError', () => {
  it('recognises what a signal actually throws', () => {
    const controller = new AbortController();
    controller.abort();
    try {
      controller.signal.throwIfAborted();
      expect.unreachable('throwIfAborted must throw once aborted');
    } catch (e) {
      // The whole 499 branch of the filter rests on this being true, and it is
      // a DOMException rather than an Error subclass one would expect.
      expect(isAbortError(e)).toBe(true);
    }
  });

  it('does not mistake an ordinary failure for a cancellation', () => {
    expect(isAbortError(new Error('socket hang up'))).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
