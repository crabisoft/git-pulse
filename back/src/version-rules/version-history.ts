import type { VersionChangeEntry } from '@repo/shared';

/** A stored change, as the table holds it. */
export interface ChangeRow {
  version: string;
  observedAt: Date;
  deploymentId: string | null;
  ref: string | null;
}

/**
 * How long each version held, over one page of a timeline.
 *
 * A version's end is the next version's beginning, so every entry is computed
 * from the row **newer** than it — which for the first row of a page is not on
 * that page at all. `newer` is that row, read separately by the caller: without
 * it, every page but the first would open with a version that appears to still
 * be running, and a timeline that is right in the middle and wrong at every
 * joint is worse than one with no durations.
 *
 * `newer` is null only where it is genuinely absent: the very newest change,
 * which is the version running now, and has no end yet.
 *
 * Rows come newest first and go out the same way: a timeline is read from what
 * is there now backwards, which is the order the question arrives in.
 */
export function toEntries(rows: readonly ChangeRow[], newer: ChangeRow | null): VersionChangeEntry[] {
  return rows.map((row, index) => {
    const successor = index === 0 ? newer : rows[index - 1];
    return {
      version: row.version,
      observedAt: row.observedAt.toISOString(),
      until: successor?.observedAt.toISOString() ?? null,
      deploymentId: row.deploymentId,
      ref: row.ref,
    };
  });
}
