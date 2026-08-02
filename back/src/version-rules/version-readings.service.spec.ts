import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionReadingsService } from './version-readings.service';
import { pairKey } from './pending-probes';
import { probe } from './version-probe';

/**
 * The network, replaced.
 *
 * The suite above never reaches it — its rule cannot be addressed at all, which
 * is what makes it a test of selection rather than of reading — and the one at
 * the bottom is about what happens between one address refusing and the next
 * being tried, which is the only place the request itself matters.
 */
vi.mock('./version-probe', () => ({ probe: vi.fn() }));

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
    { declaredFor: vi.fn().mockResolvedValue([]) } as never,
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
      { declaredFor: vi.fn().mockResolvedValue([]) } as never,
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
      { declaredFor: vi.fn() } as never,
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
      { declaredFor: vi.fn().mockResolvedValue([]) } as never,
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

// ─── Several addresses for one environment ───────────────────────────

/** A rule reading `{build.version}` off its own address. */
function route(id: string, path: string, priority: number, over: Record<string, unknown> = {}) {
  return { ...rule(), id, urlTemplate: `{environmentUrl}${path}`, priority, ...over };
}

const ACTUATOR = 'https://prod.example.com/actuator/info';
const STATIC = 'https://prod.example.com/version.json';
const LEGACY = 'https://prod.example.com/legacy';

/** What each address answers, anything unnamed timing out as one would. */
function answering(bodies: Record<string, { status: number; body: string } | null>) {
  vi.mocked(probe).mockImplementation(({ url }) => {
    const held = bodies[url];
    return Promise.resolve(
      held
        ? { ok: true, status: held.status, body: held.body, reason: null }
        : { ok: false, status: null, body: '', reason: { code: 'errors.version.timeout' } },
    );
  });
}

/** A source whose one environment several rules claim, with an address to try. */
function walking(rules: ReturnType<typeof route>[], lastAnswered: string | null = null) {
  const readings = new Map(
    lastAnswered
      ? [[pairKey('acme/api', 'prod'), { observedAt: new Date(0), deploymentId: 'dep-1', ruleId: lastAnswered }]]
      : [],
  );
  const store = {
    lastReadings: vi.fn().mockResolvedValue(readings),
    record: vi.fn().mockResolvedValue(true),
  };
  const service = new VersionReadingsService(
    { resolvedFor: vi.fn().mockResolvedValue(rules) } as never,
    store as never,
    {
      classified: vi
        .fn()
        .mockResolvedValue([deployment({ environmentUrl: 'https://prod.example.com' })]),
    } as never,
    { get: vi.fn().mockResolvedValue({ doraWindowDays: 30 }) } as never,
    { declaredFor: vi.fn().mockResolvedValue([]) } as never,
  );
  return { service, store };
}

/** The single reading a run filed for the environment. */
const filed = (store: { record: { mock: { calls: unknown[][] } } }) =>
  store.record.mock.calls[0][1] as Record<string, unknown>;

/** The addresses a run actually requested, in order. */
const requested = () => vi.mocked(probe).mock.calls.map((call) => call[0].url);

describe('several addresses for one environment', () => {
  // Half of what this suite asserts is which addresses were *not* requested,
  // and the mock is shared by the whole file.
  beforeEach(() => {
    vi.mocked(probe).mockReset();
  });

  it('tries the next address when the first does not answer', async () => {
    // The case the walk exists for: one application, two addresses, and which
    // it uses is a property of the environment rather than of its name.
    answering({ [STATIC]: { status: 200, body: '{"build":{"version":"1.4.2"}}' } });
    const { service, store } = walking([route('actuator', '/actuator/info', 10), route('static', '/version.json', 50)]);

    await service.probeSource('src-1', { force: true });

    expect(requested()).toEqual([ACTUATOR, STATIC]);
    expect(filed(store)).toMatchObject({ ruleId: 'static', status: 'ok', version: '1.4.2' });
  });

  it('tries the next one when the body is not the format the rule declared', async () => {
    // A 200 is not an answer. A proxy error page, or a single-page app serving
    // its shell on every path, answers 200 to anything asked of it.
    answering({
      [ACTUATOR]: { status: 200, body: '<!doctype html><title>Not found</title>' },
      [STATIC]: { status: 200, body: '{"build":{"version":"1.4.2"}}' },
    });
    const { service, store } = walking([route('actuator', '/actuator/info', 10), route('static', '/version.json', 50)]);

    await service.probeSource('src-1', { force: true });

    expect(filed(store)).toMatchObject({ ruleId: 'static', status: 'ok', version: '1.4.2' });
  });

  it('stops at a body that parses, even when the template read nothing out of it', async () => {
    // It parsed as declared, so the rule reached what it was written for and
    // the template is what is wrong. Walking on would file a version read
    // somewhere nobody meant to ask, and bury the failure that explains it.
    answering({
      [ACTUATOR]: { status: 200, body: '{"build":{"name":"api"}}' },
      [STATIC]: { status: 200, body: '{"build":{"version":"1.4.2"}}' },
    });
    const { service, store } = walking([route('actuator', '/actuator/info', 10), route('static', '/version.json', 50)]);

    await service.probeSource('src-1', { force: true });

    expect(requested()).toEqual([ACTUATOR]);
    expect(filed(store)).toMatchObject({
      ruleId: 'actuator',
      status: 'noMatch',
      version: null,
      error: { code: 'errors.version.pathMissing', params: { path: 'build.version' } },
    });
  });

  it('starts where the environment last answered, when the collection runs', async () => {
    // What the whole walk rests on: paid once, then only when the address that
    // was working stops. Otherwise the first two timeouts come back every
    // quarter of an hour, for ever.
    answering({ [LEGACY]: { status: 200, body: '{"build":{"version":"0.9.0"}}' } });
    const { service, store } = walking(
      [route('actuator', '/actuator/info', 10), route('static', '/version.json', 50), route('legacy', '/legacy', 90)],
      'legacy',
    );

    await service.probeSource('src-1');

    expect(requested()).toEqual([LEGACY]);
    expect(filed(store)).toMatchObject({ ruleId: 'legacy', status: 'ok', version: '0.9.0' });
  });

  it('walks the rest in order when the address that answered stops', async () => {
    answering({ [STATIC]: { status: 200, body: '{"build":{"version":"1.4.2"}}' } });
    const { service, store } = walking(
      [route('actuator', '/actuator/info', 10), route('static', '/version.json', 50), route('legacy', '/legacy', 90)],
      'legacy',
    );

    await service.probeSource('src-1');

    expect(requested()).toEqual([LEGACY, ACTUATOR, STATIC]);
    expect(filed(store)).toMatchObject({ ruleId: 'static', status: 'ok' });
  });

  it('walks the declared order instead when a person asks', async () => {
    // The saving is for the cron. Somebody who has just written a rule and
    // asked for a reading is asking what their rules do now — and a remembered
    // one answering first is how a new rule gets written, attached, and never
    // tried.
    answering({
      [ACTUATOR]: { status: 200, body: '{"build":{"version":"1.4.2"}}' },
      [LEGACY]: { status: 200, body: '{"build":{"version":"0.9.0"}}' },
    });
    const { service, store } = walking(
      [route('actuator', '/actuator/info', 10), route('legacy', '/legacy', 90)],
      'legacy',
    );

    await service.probeSource('src-1', { force: true });

    expect(requested()).toEqual([ACTUATOR]);
    expect(filed(store)).toMatchObject({ ruleId: 'actuator', version: '1.4.2' });
  });

  it('files the attempt that got furthest when every address refuses', async () => {
    // The closest thing to a working address, rather than whichever rule
    // happened to sort last: one answered with the wrong thing, one never
    // answered, one could not even be addressed.
    answering({ [STATIC]: { status: 200, body: 'not json at all' } });
    const { service, store } = walking([
      route('unaddressable', '', 5, { urlTemplate: 'https://x.example.com/{attr.client}' }),
      route('actuator', '/actuator/info', 10),
      route('static', '/version.json', 50),
    ]);

    const outcome = await service.probeSource('src-1', { force: true });

    expect(filed(store)).toMatchObject({ ruleId: 'static', status: 'noMatch' });
    expect(outcome).toMatchObject({ probed: 1, failed: 1 });
  });

  it('files one reading whatever the number of addresses tried', async () => {
    // The store holds one row per environment. Three attempts are one outcome.
    answering({ [STATIC]: { status: 200, body: '{"build":{"version":"1.4.2"}}' } });
    const { service, store } = walking([
      route('actuator', '/actuator/info', 10),
      route('legacy', '/legacy', 20),
      route('static', '/version.json', 50),
    ]);

    await service.probeSource('src-1', { force: true });

    expect(store.record).toHaveBeenCalledTimes(1);
  });

  it('counts an environment no address could be built for as unread', async () => {
    // Nothing was asked of anybody, which the outcome tells apart from a
    // request that failed — see `probed` against `skipped`.
    const { service, store } = walking([
      route('a', '', 10, { urlTemplate: 'https://x.example.com/{attr.client}' }),
      route('b', '', 20, { urlTemplate: 'https://y.example.com/{attr.client}' }),
    ]);

    const outcome = await service.probeSource('src-1', { force: true });

    expect(probe).not.toHaveBeenCalled();
    expect(filed(store)).toMatchObject({ status: 'skipped', url: null });
    expect(outcome).toMatchObject({ probed: 0, skipped: 1 });
  });
});
