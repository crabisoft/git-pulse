import { describe, expect, it } from 'vitest';
import { toEntries, type ChangeRow } from './version-history';

function change(version: string, at: string, over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    version,
    observedAt: new Date(at),
    deploymentId: `dep-${version}`,
    ref: `v${version}`,
    ...over,
  };
}

/** Newest first, as the table is read and as a timeline is looked at. */
const PAGE = [
  change('1.4.2', '2026-08-01T10:00:00.000Z'),
  change('1.4.1', '2026-07-28T10:00:00.000Z'),
  change('1.4.0', '2026-07-20T10:00:00.000Z'),
];

describe('how long each version held', () => {
  it('ends every version at the next one', () => {
    const entries = toEntries(PAGE, null);

    expect(entries[1].until).toBe('2026-08-01T10:00:00.000Z');
    expect(entries[2].until).toBe('2026-07-28T10:00:00.000Z');
  });

  it('leaves the newest one open, because it is still running', () => {
    expect(toEntries(PAGE, null)[0].until).toBeNull();
  });

  /**
   * The joint. A page that does not start at the newest change opens with a
   * version whose end is on the *previous* page — computed from the row the
   * store over-reads. Without it the entry would look like it never ended, and
   * a timeline right in the middle and wrong at every joint is worse than one
   * with no durations at all.
   */
  it('ends the first entry of a later page at the row above it', () => {
    const newer = change('1.5.0', '2026-08-02T09:00:00.000Z');

    const entries = toEntries(PAGE, newer);

    expect(entries[0].until).toBe('2026-08-02T09:00:00.000Z');
    // And the rest are unaffected: the joint is the only thing that changes.
    expect(entries[1].until).toBe('2026-08-01T10:00:00.000Z');
  });

  it('carries the deployment that explains a version, and its ref', () => {
    const entries = toEntries([change('1.4.2', '2026-08-01T10:00:00.000Z')], null);

    expect(entries[0]).toMatchObject({ deploymentId: 'dep-1.4.2', ref: 'v1.4.2' });
  });

  it('keeps a change no deployment explains, saying so with a null', () => {
    // The signal this table exists for: something moved the version and the
    // platform knows nothing about it.
    const entries = toEntries(
      [change('1.4.0', '2026-07-20T10:00:00.000Z', { deploymentId: null, ref: null })],
      null,
    );

    expect(entries[0].deploymentId).toBeNull();
    expect(entries[0].version).toBe('1.4.0');
  });

  it('has nothing to say about an empty page', () => {
    expect(toEntries([], null)).toEqual([]);
  });
});
