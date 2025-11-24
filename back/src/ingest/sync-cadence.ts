/**
 * When the ingestion reconciles, and how far back it reads.
 *
 * Pure on purpose, like the merge rules next door: these two decisions are what
 * keep a stored source converging on its provider, and they have to hold on an
 * install that receives no webhook at all. Testing that must not need a
 * database, a queue or an HTTP client.
 */

/**
 * How far back a delta re-reads.
 *
 * A run takes time, and a provider stamps a change when it happens rather than
 * when we ask. Overlapping the window costs a few rows read twice — the upserts
 * are idempotent — and saves the ones that moved while the previous run was
 * still in flight.
 */
export const DELTA_OVERLAP_MS = 10 * 60_000;

/**
 * How often the reconciliation pass runs, whatever the delta cadence.
 *
 * Deliberately a duration rather than a count of runs: it has to hold on an
 * install where the collection is rescheduled, paused or restarted. And it is
 * deliberately blind to the events received — a source nothing ever notifies
 * reconciles exactly as often as one flooded with webhooks, which is the whole
 * of what makes the scheduled path autonomous.
 */
export const FULL_SYNC_INTERVAL_MS = 6 * 3_600_000;

/**
 * How recently an event must have arrived for the incremental listings to be
 * worth skipping. Below it, the store is demonstrably being kept current by
 * something cheaper than a listing.
 */
export const EVENT_QUIET_MS = 15 * 60_000;

const DAY_MS = 86_400_000;

/**
 * Whether the incremental listings can be skipped this run.
 *
 * This is the **only** place the events influence the schedule, and it is
 * deliberately one-way: they can spare a listing, never postpone a
 * reconciliation. `full` short-circuits before anything else is read, so a flood
 * of events cannot turn into a source that stops being checked against its
 * provider — which is the failure mode this whole design exists to avoid.
 */
export function skipsDelta(lastEventAt: Date | null, now: Date, full: boolean): boolean {
  if (full || !lastEventAt) return false;
  return now.getTime() - lastEventAt.getTime() < EVENT_QUIET_MS;
}

/**
 * Lower bound of the merged listing.
 *
 * A reconciliation re-reads the whole reporting window — the only way a merge
 * missed on both transports ever comes back. A delta starts at the cursor,
 * backed off by the overlap, and never reaches further back than the window
 * anything is computed over: re-reading merges nobody will look at costs calls
 * and buys nothing.
 */
export function mergedSince(
  cursor: Date | null,
  now: Date,
  windowDays: number,
  full: boolean,
): Date {
  const windowStart = now.getTime() - windowDays * DAY_MS;
  if (full || !cursor) return new Date(windowStart);
  return new Date(Math.max(windowStart, cursor.getTime() - DELTA_OVERLAP_MS));
}

/**
 * Whether this run reconciles.
 *
 * True when a source has never run — it has nothing to be incremental from —
 * and true as soon as **any** of its listings is overdue: they share a window,
 * so reconciling three of them and not the fourth would leave the pruning to
 * work from a repository list older than the rows it is deciding about.
 */
export function isDueForFullSync(lastFullSyncAts: Array<Date | null>, now: Date): boolean {
  if (lastFullSyncAts.length === 0) return true;
  return lastFullSyncAts.some(
    (at) => at === null || now.getTime() - at.getTime() >= FULL_SYNC_INTERVAL_MS,
  );
}
