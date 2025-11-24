import { describe, expect, it } from 'vitest';
import {
  DELTA_OVERLAP_MS,
  EVENT_QUIET_MS,
  FULL_SYNC_INTERVAL_MS,
  isDueForFullSync,
  mergedSince,
  skipsDelta,
} from './sync-cadence';

const NOW = new Date('2026-07-27T12:00:00Z');
const WINDOW_DAYS = 30;

describe('mergedSince', () => {
  it('re-reads the whole reporting window on a reconciliation', () => {
    const since = mergedSince(new Date('2026-07-27T11:50:00Z'), NOW, WINDOW_DAYS, true);
    expect(since).toEqual(new Date('2026-06-27T12:00:00Z'));
  });

  it('starts at the cursor, backed off by the overlap', () => {
    const cursor = new Date('2026-07-27T11:00:00Z');
    const since = mergedSince(cursor, NOW, WINDOW_DAYS, false);
    expect(since).toEqual(new Date(cursor.getTime() - DELTA_OVERLAP_MS));
  });

  it('never reaches further back than the window', () => {
    // A source that has not run for months would otherwise ask for a year of
    // merges nothing computes over.
    const cursor = new Date('2026-01-01T00:00:00Z');
    expect(mergedSince(cursor, NOW, WINDOW_DAYS, false)).toEqual(new Date('2026-06-27T12:00:00Z'));
  });

  it('reads the whole window when there is no cursor yet', () => {
    expect(mergedSince(null, NOW, WINDOW_DAYS, false)).toEqual(new Date('2026-06-27T12:00:00Z'));
  });
});

describe('isDueForFullSync', () => {
  it('reconciles a source that has never run', () => {
    expect(isDueForFullSync([], NOW)).toBe(true);
  });

  it('reconciles as soon as one listing is overdue', () => {
    const fresh = new Date(NOW.getTime() - 60_000);
    const overdue = new Date(NOW.getTime() - FULL_SYNC_INTERVAL_MS);
    expect(isDueForFullSync([fresh, fresh, overdue], NOW)).toBe(true);
  });

  it('reconciles a listing that never did', () => {
    const fresh = new Date(NOW.getTime() - 60_000);
    expect(isDueForFullSync([fresh, null], NOW)).toBe(true);
  });

  it('stays incremental while every listing is recent', () => {
    const fresh = new Date(NOW.getTime() - FULL_SYNC_INTERVAL_MS + 60_000);
    expect(isDueForFullSync([fresh, fresh], NOW)).toBe(false);
  });
});

describe('skipsDelta', () => {
  it('spares a listing while the events keep flowing', () => {
    const recent = new Date(NOW.getTime() - EVENT_QUIET_MS + 60_000);
    expect(skipsDelta(recent, NOW, false)).toBe(true);
  });

  it('lists again once the events go quiet', () => {
    const old = new Date(NOW.getTime() - EVENT_QUIET_MS);
    expect(skipsDelta(old, NOW, false)).toBe(false);
  });

  it('lists on a source no event ever reached', () => {
    // The install whose network refuses inbound traffic. It must behave exactly
    // as it would with the feature absent.
    expect(skipsDelta(null, NOW, false)).toBe(false);
  });

  it('never skips a reconciliation, however fresh the events', () => {
    // A flood of events must not become a source that stops being checked
    // against its provider.
    expect(skipsDelta(NOW, NOW, true)).toBe(false);
  });
});
