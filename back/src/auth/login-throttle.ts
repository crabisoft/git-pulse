import { Injectable } from '@nestjs/common';

/**
 * How long a failure is remembered. Reaching a bucket's limit within it is what
 * closes sign-in, and the block runs out with the last failure counted — so an
 * attacker who keeps hammering stays out, while someone who simply mistyped
 * waits this out at worst.
 */
export const WINDOW_MS = 15 * 60 * 1000;

/**
 * Two buckets, because they answer different attacks. The address bucket stops
 * one account being ground through a password list; the IP bucket stops one
 * caller spraying a password across many addresses. The address limit is the
 * looser of the two in practice — locking an account is itself a denial of
 * service against its owner, so it stays high enough that a bad day at the
 * keyboard never reaches it.
 */
const LIMITS = { email: 10, ip: 30 } as const;

/** What a sign-in attempt is counted against. */
export interface LoginKeys {
  email: string;
  ip: string;
}

interface Bucket {
  count: number;
  /** When the count is forgotten; pushed back by every failure. */
  expiresAt: number;
}

/**
 * Failed sign-in counter, held in this process. Deliberately not in Redis: the
 * API runs as a single container in both stacks, and a store on the sign-in
 * path is a store whose outage takes sign-in down with it. A restart clears the
 * counters, which an attacker cannot cause; a multi-replica deployment would
 * need a shared store to be exact, and would still be protected per replica.
 */
@Injectable()
export class LoginThrottle {
  private readonly buckets = new Map<string, Bucket>();

  /** Milliseconds to wait before trying again, or 0 to let the attempt through. */
  retryAfter(keys: LoginKeys, now: number = Date.now()): number {
    let wait = 0;
    for (const [kind, value] of Object.entries(keys) as [keyof LoginKeys, string][]) {
      const bucket = this.buckets.get(`${kind}:${value}`);
      if (!bucket || bucket.expiresAt <= now || bucket.count < LIMITS[kind]) continue;
      wait = Math.max(wait, bucket.expiresAt - now);
    }
    return wait;
  }

  recordFailure(keys: LoginKeys, now: number = Date.now()): void {
    for (const [kind, value] of Object.entries(keys)) {
      const key = `${kind}:${value}`;
      const bucket = this.buckets.get(key);
      const count = bucket && bucket.expiresAt > now ? bucket.count + 1 : 1;
      this.buckets.set(key, { count, expiresAt: now + WINDOW_MS });
    }
    this.prune(now);
  }

  /** Signing in clears the way: a right password ends the suspicion. */
  clear(keys: LoginKeys): void {
    for (const [kind, value] of Object.entries(keys)) this.buckets.delete(`${kind}:${value}`);
  }

  /**
   * Failures come with attacker-chosen addresses, so the map would otherwise
   * grow with them. Swept only once it is large enough to be worth walking.
   */
  private prune(now: number): void {
    if (this.buckets.size < 5000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key);
    }
  }
}
