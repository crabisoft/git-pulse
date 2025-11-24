/**
 * Authentication of an incoming delivery.
 *
 * Pure on purpose, and more so than anything else here: this is the one place
 * where a bug is a hole rather than a wrong number, and it has to be exercisable
 * without an HTTP server, a database or a provider. Everything it needs is the
 * bytes as they arrived, the headers, and the secret.
 *
 * The endpoint it guards is anonymous to the session layer — GitHub and GitLab
 * hold no account here — which is exactly why the signature is not optional: it
 * *is* the authentication, not a supplement to one.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SourceKind } from '@repo/shared';

/** Headers as Express hands them over. */
export type HeaderBag = Record<string, string | string[] | undefined>;

/** Why a delivery was refused. Never shown to the caller, only logged. */
export type RejectReason = 'unsigned' | 'bad-signature' | 'no-event';

export type Verdict =
  | { ok: true; deliveryId: string; event: string }
  | { ok: false; reason: RejectReason };

/**
 * Authenticates a delivery against the secret stored for its source.
 *
 * The two providers do not offer the same guarantee, and the difference is
 * worth stating rather than smoothing over:
 *
 * - GitHub signs the **body** with the secret, so a valid signature proves both
 *   who sent it and that nothing was altered on the way.
 * - GitLab sends the secret itself in a header, which proves who sent it and
 *   nothing more. Over HTTPS that is still an authentication; it is not an
 *   integrity check, which is one reason an event here is treated as a hint
 *   about what changed rather than as a source of truth.
 */
export function verify(kind: SourceKind, headers: HeaderBag, body: Buffer, secret: string): Verdict {
  return kind === 'github'
    ? verifyGitHub(headers, body, secret)
    : verifyGitLab(headers, secret);
}

function verifyGitHub(headers: HeaderBag, body: Buffer, secret: string): Verdict {
  const event = readHeader(headers, 'x-github-event');
  if (!event) return { ok: false, reason: 'no-event' };

  const signature = readHeader(headers, 'x-hub-signature-256');
  if (!signature) return { ok: false, reason: 'unsigned' };

  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  if (!constantTimeEquals(signature, expected)) return { ok: false, reason: 'bad-signature' };

  // A delivery id is always sent; falling back to the digest keeps the
  // deduplication working rather than letting a missing header disable it.
  const deliveryId = readHeader(headers, 'x-github-delivery') ?? expected;
  return { ok: true, deliveryId, event };
}

function verifyGitLab(headers: HeaderBag, secret: string): Verdict {
  const event = readHeader(headers, 'x-gitlab-event');
  if (!event) return { ok: false, reason: 'no-event' };

  const token = readHeader(headers, 'x-gitlab-token');
  if (!token) return { ok: false, reason: 'unsigned' };
  if (!constantTimeEquals(token, secret)) return { ok: false, reason: 'bad-signature' };

  // Sent by recent GitLab versions only; older ones get a per-request id, which
  // simply means no deduplication rather than a refused delivery.
  const deliveryId = readHeader(headers, 'x-gitlab-event-uuid');
  return { ok: true, deliveryId: deliveryId ?? `${event}:${Date.now()}`, event };
}

/**
 * Compares without leaking where the two differ through how long it took.
 *
 * The length check before it leaks the length, which is not a secret — and
 * `timingSafeEqual` throws on mismatched lengths, so there is no version of
 * this that avoids it.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readHeader(headers: HeaderBag, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value === '' ? undefined : value;
}
