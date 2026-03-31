import { describe, expect, it, vi } from 'vitest';
import { VersionReadingStore } from './version-reading.store';
import { subjectKey, type ClassifySubject } from '../env-rules/env-rules.service';

/** A stored row, as Prisma hands it back. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    repo: 'acme/api',
    environment: 'prod-acme',
    version: '1.4.2',
    deploymentId: 'dep-1',
    ref: 'v1.4.2',
    ruleId: 'vr-1',
    url: 'https://api.acme.test/version',
    status: 'ok',
    error: null,
    observedAt: new Date('2026-08-01T10:00:00.000Z'),
    changedAt: null,
    ...over,
  };
}

/**
 * The classifier, answering per pair. Anything it was not given an answer for
 * is a pair no rule matched — which is a real outcome, not a missing case.
 */
function classifier(answers: Record<string, { attributes: Record<string, string>; metaEnvironments: string[] }>) {
  return {
    classifyByPair: vi.fn(async (_sourceId: string, subjects: ClassifySubject[]) => {
      const found = new Map<string, unknown>();
      for (const subject of subjects) {
        const answer = answers[`${subject.repo}/${subject.name}`];
        if (answer) found.set(subjectKey(subject), { name: subject.name, ...answer });
      }
      return found;
    }),
  };
}

function build(rows: ReturnType<typeof row>[], answers: Parameters<typeof classifier>[0] = {}) {
  const prisma = { environmentVersion: { findMany: vi.fn().mockResolvedValue(rows) } };
  const envRules = classifier(answers);
  return {
    store: new VersionReadingStore(prisma as never, envRules as never),
    prisma,
    envRules,
  };
}

/**
 * A store whose writes are captured rather than executed. `$transaction` takes
 * the operations the methods built, so asserting on what was handed to it is
 * asserting on exactly what would have been written.
 */
function writable(existing: { version: string | null; changedAt: Date | null } | null = null) {
  const deploymentVersion = { upsert: vi.fn((args: unknown) => ({ table: 'frozen', args })) };
  const prisma = {
    environmentVersion: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn((args: unknown) => ({ table: 'current', args })),
    },
    versionChange: { create: vi.fn((args: unknown) => ({ table: 'change', args })) },
    deploymentVersion,
    $transaction: vi.fn().mockResolvedValue([]),
  };
  return {
    store: new VersionReadingStore(prisma as never, classifier({}) as never),
    prisma,
    /** What the frozen upsert was called with, or null when it was not. */
    frozen: () => deploymentVersion.upsert.mock.calls[0]?.[0] as
      | { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }
      | undefined,
  };
}

/** A reading as the prober files one. */
function reading(over: Record<string, unknown> = {}) {
  return {
    repo: 'acme/api',
    environment: 'prod',
    version: '1.4.2',
    deploymentId: 'dep-1',
    ref: 'v1.4.2',
    ruleId: 'vr-1',
    url: 'https://api.acme.test/version',
    status: 'ok' as const,
    error: null,
    observedAt: new Date('2026-08-02T10:05:00.000Z'),
    deployedAt: new Date('2026-08-02T10:00:00.000Z'),
    ...over,
  };
}

describe('VersionReadingStore.latest', () => {
  it('attaches the attributes and the meta-environments of its own pair', async () => {
    const { store } = build(
      [row(), row({ repo: 'acme/web', environment: 'qa-globex', version: '2.0.0' })],
      {
        'acme/api/prod-acme': {
          attributes: { client: 'acme', type: 'prod' },
          metaEnvironments: ['production'],
        },
        'acme/web/qa-globex': { attributes: { client: 'globex' }, metaEnvironments: [] },
      },
    );

    const [api, web] = await store.latest('src-1');

    expect(api.attributes).toEqual({ client: 'acme', type: 'prod' });
    expect(api.metaEnvironments).toEqual(['production']);
    // Keyed on the pair, so one row never wears another's classification.
    expect(web.attributes).toEqual({ client: 'globex' });
    expect(web.metaEnvironments).toEqual([]);
  });

  it('keeps a reading no rule matched, with nothing attached', async () => {
    // Dropping it would hide the environment whose rule is missing, which is
    // the one thing the reader could act on.
    const { store } = build([row({ environment: 'staging-unknown' })]);

    const [reading] = await store.latest('src-1');

    expect(reading.environment).toBe('staging-unknown');
    expect(reading.attributes).toEqual({});
    expect(reading.metaEnvironments).toEqual([]);
  });

  it('classifies the same environment name once per repo it appears in', async () => {
    // A rule confined to a repo makes one name classify two ways, so the pair
    // is the unit — never the name alone.
    const { store, envRules } = build(
      [
        row({ repo: 'acme/api', environment: 'prod' }),
        row({ repo: 'acme/web', environment: 'prod' }),
      ],
      {
        'acme/api/prod': { attributes: { app: 'api' }, metaEnvironments: [] },
        'acme/web/prod': { attributes: { app: 'web' }, metaEnvironments: [] },
      },
    );

    const readings = await store.latest('src-1');

    expect(readings.map((r) => r.attributes.app)).toEqual(['api', 'web']);
    // One read of the rules for the whole batch, not one per row.
    expect(envRules.classifyByPair).toHaveBeenCalledTimes(1);
  });

  it('hands back what the row holds, dates as ISO', async () => {
    const { store } = build([row({ changedAt: new Date('2026-07-31T08:00:00.000Z') })]);

    const [reading] = await store.latest('src-1');

    expect(reading).toMatchObject({
      repo: 'acme/api',
      version: '1.4.2',
      deploymentId: 'dep-1',
      ref: 'v1.4.2',
      status: 'ok',
      observedAt: '2026-08-01T10:00:00.000Z',
      changedAt: '2026-07-31T08:00:00.000Z',
    });
  });

  it('reports a failed reading as one, rather than dropping it', async () => {
    const { store } = build([
      row({ version: null, status: 'unreachable', error: { code: 'errors.version.timeout' } }),
    ]);

    const [reading] = await store.latest('src-1');

    expect(reading.version).toBeNull();
    expect(reading.status).toBe('unreachable');
    expect(reading.error).toEqual({ code: 'errors.version.timeout' });
  });
});

describe('freezing a reading against its deployment', () => {
  it('writes the deployment it describes, with the delay it was read after', async () => {
    const { store, frozen } = writable();

    await store.record('src-1', reading());

    expect(frozen()?.where).toEqual({
      sourceId_deploymentId: { sourceId: 'src-1', deploymentId: 'dep-1' },
    });
    // Five minutes after the deployment: the number a reader weighs the
    // reading with, and the reason it is stored rather than re-derived.
    expect(frozen()?.create).toMatchObject({ version: '1.4.2', delaySec: 300 });
  });

  it('lets a later reading correct an earlier one', async () => {
    // The failure mode this exists for: the first probe catches the
    // application mid-restart and reads the version being replaced. Everywhere
    // else that fixes itself at the next reading; a frozen row has no next
    // reading, so the write has to be an upsert.
    const { store, prisma } = writable();

    await store.record('src-1', reading({ version: '1.4.1' }));
    await store.record(
      'src-1',
      reading({ version: '1.4.2', observedAt: new Date('2026-08-02T10:20:00.000Z') }),
    );

    const calls = prisma.deploymentVersion.upsert.mock.calls as Array<
      [{ where: unknown; update: Record<string, unknown> }]
    >;
    expect(calls).toHaveLength(2);
    // Same row both times — the deployment, not the reading, is the key.
    expect(calls[1][0].where).toEqual(calls[0][0].where);
    // And the second one replaces what the first wrote, delay included.
    expect(calls[1][0].update).toMatchObject({ version: '1.4.2', delaySec: 1200 });
  });

  it('freezes a failed reading too, rather than leaving the deployment blank', async () => {
    // "We asked and got nothing" is a different fact from "nobody asked", and
    // only one of the two can still be acted on.
    const { store, frozen } = writable();

    await store.record(
      'src-1',
      reading({ version: null, status: 'unreachable', error: { code: 'errors.version.timeout' } }),
    );

    expect(frozen()?.create).toMatchObject({
      version: null,
      status: 'unreachable',
      error: { code: 'errors.version.timeout' },
    });
  });

  it('freezes nothing when the reading names no deployment', async () => {
    const { store, frozen } = writable();

    await store.record('src-1', reading({ deploymentId: null, deployedAt: null }));

    expect(frozen()).toBeUndefined();
  });

  it('never reports a reading taken before its own deployment', async () => {
    // Two clocks, one of them the provider's. A negative delay would read as a
    // version confirmed before it was deployed.
    const { store, frozen } = writable();

    await store.record(
      'src-1',
      reading({
        observedAt: new Date('2026-08-02T09:59:00.000Z'),
        deployedAt: new Date('2026-08-02T10:00:00.000Z'),
      }),
    );

    expect(frozen()?.create).toMatchObject({ delaySec: 0 });
  });
});
