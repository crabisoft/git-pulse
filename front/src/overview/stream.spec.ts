import { describe, expect, it } from 'vitest';
import type { Incident, OverviewEvent, PipelineStatus } from '@repo/shared';
import { dayOf, toStream, within } from './stream';

function deployment(
  at: string,
  status: PipelineStatus = 'success',
  over: Partial<OverviewEvent> = {},
): OverviewEvent {
  return {
    id: `gh:acme/api:${at}`,
    at,
    environment: 'prod-acme-api',
    repo: 'acme/api',
    ref: 'v2.14.1',
    status,
    url: 'https://example.test/deployments/1',
    attributes: { type: 'prod' },
    ...over,
  };
}

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'gh:acme/api:118',
    key: 'INC-118',
    title: 'Payments returning 502',
    url: 'https://example.test/issues/118',
    openedAt: '2026-07-30T11:40:00.000Z',
    resolvedAt: null,
    labels: ['incident'],
    tickets: [],
    ...over,
  };
}

describe('toStream', () => {
  it('interleaves deployments and incidents on one rail, newest first', () => {
    // The sentence the view exists for: an incident twenty minutes after a
    // release, told by neither source on its own.
    const entries = toStream(
      [deployment('2026-07-30T11:18:00.000Z'), deployment('2026-07-30T14:32:00.000Z')],
      [incident()],
    );

    expect(entries.map((e) => e.at)).toEqual([
      '2026-07-30T14:32:00.000Z',
      '2026-07-30T11:40:00.000Z',
      '2026-07-30T11:18:00.000Z',
    ]);
  });

  it('reads a failed deployment as its own kind of moment', () => {
    const [entry] = toStream([deployment('2026-07-30T14:00:00.000Z', 'failed')], []);
    expect(entry.kind).toBe('failure');
  });

  it('puts a resolution at the time it was resolved, not at the breakage', () => {
    // Collapsing the two would date the recovery to the outage.
    const entries = toStream([], [incident({ resolvedAt: '2026-07-30T12:21:00.000Z' })]);

    expect(entries.map((e) => e.kind)).toEqual(['resolved', 'incident']);
    expect(entries[0].at).toBe('2026-07-30T12:21:00.000Z');
    expect(entries[0].detail).toBe('41 min');
  });

  it('leaves an open incident with a single moment', () => {
    const entries = toStream([], [incident()]);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('incident');
  });

  it('opens a deployment where the platform publishes it', () => {
    const [entry] = toStream([deployment('2026-07-30T14:00:00.000Z')], []);
    expect(entry.url).toBe('https://example.test/deployments/1');
  });

  it('leaves a deployment the platform publishes no page for unlinked', () => {
    // GitHub publishes none when the status call was given up under the API
    // reserve, and a dead link would be worse than none.
    const [entry] = toStream(
      [deployment('2026-07-30T14:00:00.000Z', 'success', { url: null })],
      [],
    );
    expect(entry.url).toBeNull();
  });

  it('tells two deployments of the same environment in the same second apart', () => {
    // The 24-hour event list carried no identity, so the key was built from the
    // environment and the instant — and two rows collapsed into one.
    const entries = toStream(
      [
        deployment('2026-07-30T14:00:00.000Z', 'success', { id: 'gh:acme/api:1' }),
        deployment('2026-07-30T14:00:00.000Z', 'success', { id: 'gh:acme/api:2' }),
      ],
      [],
    );
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
  });

  it('gives every entry an identity of its own', () => {
    const entries = toStream(
      [deployment('2026-07-30T14:00:00.000Z')],
      [incident({ resolvedAt: '2026-07-30T12:21:00.000Z' })],
    );
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });
});

describe('within', () => {
  const NOW = new Date('2026-07-30T12:00:00.000Z').getTime();

  it('keeps what happened inside the window', () => {
    const entries = toStream(
      [deployment('2026-07-29T13:00:00.000Z'), deployment('2026-07-30T11:00:00.000Z')],
      [],
    );
    expect(within(entries, 48, NOW)).toHaveLength(2);
  });

  it('drops what falls the other side of it', () => {
    // Two feeds, two windows: the events arrive over the one the API sends,
    // the incidents over the one asked for, and the rail has to be one window.
    const entries = toStream(
      [deployment('2026-07-30T11:00:00.000Z')],
      [incident({ openedAt: '2026-06-15T09:00:00.000Z' })],
    );

    const kept = within(entries, 48, NOW);

    expect(kept).toHaveLength(1);
    expect(kept[0].kind).toBe('deploy');
  });

  it('keeps a moment on the boundary rather than losing it to rounding', () => {
    const entries = toStream([deployment('2026-07-28T12:00:00.000Z')], []);
    expect(within(entries, 48, NOW)).toHaveLength(1);
  });
});

describe('dayOf', () => {
  it('groups by the reader’s calendar day, not by UTC', () => {
    // A deployment at 23:30 local is not yesterday's work because UTC says so.
    const at = new Date(2026, 6, 30, 23, 30);
    expect(dayOf(at.toISOString())).toBe('2026-07-30');
  });
});
