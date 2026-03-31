import { describe, expect, it, vi } from 'vitest';
import { VersionReadingsService } from './version-readings.service';
import { pairKey } from './pending-probes';

/**
 * A rule addressing the environment URL, against a deployment that has none.
 *
 * Deliberate: `probeUrl` then refuses before anything is requested, so these
 * tests never touch the network while still going through the whole selection.
 * What is being asserted is *which environments a run decides to read*, and a
 * refusal is filed exactly like a reading — see `readOne`.
 */
function rule() {
  return {
    id: 'vr-1',
    name: 'Actuator',
    environment: null,
    repo: null,
    urlTemplate: '{environmentUrl}/actuator/info',
    format: 'json' as const,
    template: '{build.version}',
    pattern: null,
    headers: {},
    priority: 100,
    auth: { kind: 'none' as const, header: null, secret: null },
  };
}

function deployment(over: Record<string, unknown> = {}) {
  return {
    id: 'dep-1',
    repo: 'acme/api',
    environment: 'prod',
    ref: 'v1.4.2',
    status: 'success',
    createdAt: '2026-08-01T09:00:00.000Z',
    environmentUrl: null,
    url: null,
    attributes: {},
    metaEnvironments: [],
    refUrl: 'https://example.test/tree/v1.4.2',
    ...over,
  };
}

/** A source with one rule, one deployed environment, and a reading just taken. */
function build(lastReadMinutesAgo: number | null = 3) {
  const readings = new Map<string, { observedAt: Date; deploymentId: string | null }>();
  if (lastReadMinutesAgo !== null) {
    readings.set(pairKey('acme/api', 'prod'), {
      observedAt: new Date(Date.now() - lastReadMinutesAgo * 60_000),
      // The same deployment the candidate carries: a new one would make the
      // environment due whatever the interval says, which is the other rule.
      deploymentId: 'dep-1',
    });
  }

  const store = {
    lastReadings: vi.fn().mockResolvedValue(readings),
    record: vi.fn().mockResolvedValue(false),
  };
  const service = new VersionReadingsService(
    { resolvedFor: vi.fn().mockResolvedValue([rule()]) } as never,
    store as never,
    { classified: vi.fn().mockResolvedValue([deployment()]) } as never,
    { get: vi.fn().mockResolvedValue({ doraWindowDays: 30 }) } as never,
  );
  return { service, store };
}

describe('what a run decides to read', () => {
  it('leaves a fresh reading alone when the collection runs', async () => {
    const { service, store } = build(3);

    const outcome = await service.probeSource('src-1');

    // Read three minutes ago against the same deployment: the interval is what
    // keeps a cron from asking somebody's application every few minutes.
    expect(store.record).not.toHaveBeenCalled();
    expect(outcome.skipped).toBe(1);
    expect(outcome.probed).toBe(0);
  });

  it('reads it anyway when a person asks', async () => {
    const { service, store } = build(3);

    await service.probeSource('src-1', { force: true });

    // The reading they are trying to replace is exactly the one the interval
    // would have protected, so a forced run that reported `skipped` would look
    // broken to whoever clicked.
    expect(store.record).toHaveBeenCalledTimes(1);
  });

  it('freezes nothing against a deployment that failed', async () => {
    // It put nothing on the environment, so whatever answers there now belongs
    // to the deployment before it — freezing that against the failure would
    // record a version this deployment never delivered.
    const store = { lastReadings: vi.fn().mockResolvedValue(new Map()), record: vi.fn() };
    const service = new VersionReadingsService(
      { resolvedFor: vi.fn().mockResolvedValue([rule()]) } as never,
      store as never,
      { classified: vi.fn().mockResolvedValue([deployment({ status: 'failure' })]) } as never,
      { get: vi.fn().mockResolvedValue({ doraWindowDays: 30 }) } as never,
    );

    const outcome = await service.probeSource('src-1', { force: true });

    expect(store.record).not.toHaveBeenCalled();
    expect(outcome.environments).toBe(0);
  });

  it('files a reading against the deployment that put it there', async () => {
    // What the frozen row is keyed on: the reading has to carry the deployment
    // and the moment it went out, or there is nothing to freeze it against.
    const { service, store } = build(null);

    await service.probeSource('src-1', { force: true });

    expect(store.record).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({
        deploymentId: 'dep-1',
        deployedAt: new Date('2026-08-01T09:00:00.000Z'),
      }),
    );
  });

  it('reads an environment nobody has ever read, forced or not', async () => {
    for (const options of [{}, { force: true }]) {
      const { service, store } = build(null);

      await service.probeSource('src-1', options);

      expect(store.record).toHaveBeenCalledTimes(1);
    }
  });
});

describe('what a run reports', () => {
  it('says a source has no rule rather than reporting four zeroes', async () => {
    const service = new VersionReadingsService(
      { resolvedFor: vi.fn().mockResolvedValue([]) } as never,
      { lastReadings: vi.fn(), record: vi.fn() } as never,
      { classified: vi.fn() } as never,
      { get: vi.fn() } as never,
    );

    const outcome = await service.probeSource('src-1', { force: true });

    expect(outcome.rules).toBe(0);
    expect(outcome).toMatchObject({ probed: 0, skipped: 0, failed: 0, changed: 0 });
  });

  it('says the rules are attached and no environment was found', async () => {
    // The diagnosis nothing else gives: the rules are fine, and no deployment
    // has ever been collected for them to describe.
    const service = new VersionReadingsService(
      { resolvedFor: vi.fn().mockResolvedValue([rule()]) } as never,
      { lastReadings: vi.fn().mockResolvedValue(new Map()), record: vi.fn() } as never,
      { classified: vi.fn().mockResolvedValue([]) } as never,
      { get: vi.fn().mockResolvedValue({ doraWindowDays: 30 }) } as never,
    );

    const outcome = await service.probeSource('src-1', { force: true });

    expect(outcome.rules).toBe(1);
    expect(outcome.environments).toBe(0);
  });

  it('counts the environments its rules could speak for', async () => {
    const { service } = build(null);

    const outcome = await service.probeSource('src-1', { force: true });

    expect(outcome).toMatchObject({ rules: 1, environments: 1 });
  });
});
