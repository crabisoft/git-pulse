import { describe, expect, it } from 'vitest';
import {
  latestPerEnvironment,
  pairKey,
  selectProbes,
  withDeclared,
  type LastReading,
  type ProbeCandidate,
} from './pending-probes';

const candidate = (over: Partial<ProbeCandidate> = {}): ProbeCandidate => ({
  repo: 'billing',
  environment: 'prod',
  deploymentId: 'd1',
  ref: 'v1.4.2',
  deployedAt: '2026-08-01T10:00:00.000Z',
  environmentUrl: null,
  attributes: {},
  ...over,
});

const now = new Date('2026-08-01T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

/** The rule that answered defaults to none: nothing here reads it. */
const readings = (entries: Array<[ProbeCandidate, Omit<LastReading, 'ruleId'>]>) =>
  new Map(entries.map(([c, last]) => [pairKey(c.repo, c.environment), { ruleId: null, ...last }]));

describe('selectProbes', () => {
  it('reads an environment nobody has ever read', () => {
    const selection = selectProbes([candidate()], new Map(), now);
    expect(selection.targets).toHaveLength(1);
    expect(selection.skipped).toBe(0);
  });

  it('leaves an environment read within the interval alone', () => {
    const target = candidate();
    const selection = selectProbes(
      [target],
      readings([[target, { observedAt: minutesAgo(5), deploymentId: 'd1' }]]),
      now,
    );
    expect(selection.targets).toEqual([]);
    expect(selection.skipped).toBe(1);
  });

  it('reads it again once the interval has passed', () => {
    const target = candidate();
    const selection = selectProbes(
      [target],
      readings([[target, { observedAt: minutesAgo(20), deploymentId: 'd1' }]]),
      now,
    );
    expect(selection.targets).toEqual([target]);
  });

  it('reads it straight away when something was deployed since', () => {
    // The interval must never delay this: confirming a deployment a quarter of
    // an hour later is not confirming a deployment.
    const target = candidate({ deploymentId: 'd2' });
    const selection = selectProbes(
      [target],
      readings([[target, { observedAt: minutesAgo(1), deploymentId: 'd1' }]]),
      now,
    );
    expect(selection.targets).toEqual([target]);
    expect(selection.skipped).toBe(0);
  });

  it('caps a run and says how much it left behind', () => {
    const many = Array.from({ length: 30 }, (_, i) => candidate({ environment: `env-${i}` }));
    const selection = selectProbes(many, new Map(), now, 25);
    expect(selection.targets).toHaveLength(25);
    expect(selection.deferred).toBe(5);
  });

  it('takes the never-read before the freshly deployed, and both before the stale', () => {
    const fresh = candidate({ environment: 'fresh', deploymentId: 'd2' });
    const stale = candidate({ environment: 'stale' });
    const never = candidate({ environment: 'never' });
    const selection = selectProbes(
      [stale, fresh, never],
      readings([
        [fresh, { observedAt: minutesAgo(1), deploymentId: 'd1' }],
        [stale, { observedAt: minutesAgo(90), deploymentId: 'd1' }],
      ]),
      now,
      2,
    );
    expect(selection.targets.map((t) => t.environment)).toEqual(['never', 'fresh']);
    expect(selection.deferred).toBe(1);
  });

  it('takes the stalest reading first among equals', () => {
    const older = candidate({ environment: 'older' });
    const newer = candidate({ environment: 'newer' });
    const selection = selectProbes(
      [newer, older],
      readings([
        [older, { observedAt: minutesAgo(300), deploymentId: 'd1' }],
        [newer, { observedAt: minutesAgo(30), deploymentId: 'd1' }],
      ]),
      now,
      1,
    );
    expect(selection.targets.map((t) => t.environment)).toEqual(['older']);
  });

  it('distinguishes the same environment name in two repos', () => {
    const billing = candidate({ repo: 'billing' });
    const portal = candidate({ repo: 'portal' });
    const selection = selectProbes(
      [billing, portal],
      readings([[billing, { observedAt: minutesAgo(1), deploymentId: 'd1' }]]),
      now,
    );
    expect(selection.targets.map((t) => t.repo)).toEqual(['portal']);
  });
});

describe('latestPerEnvironment', () => {
  const deployment = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    repo: 'billing',
    environment: 'prod',
    ref: 'v1.4.2',
    status: 'success',
    createdAt: '2026-08-01T10:00:00.000Z',
    environmentUrl: null,
    attributes: {},
    ...over,
  });

  it('keeps the most recent deployment of each environment', () => {
    const candidates = latestPerEnvironment([
      deployment({ id: 'old', createdAt: '2026-07-30T10:00:00.000Z', ref: 'v1.4.1' }),
      deployment({ id: 'new', createdAt: '2026-08-01T10:00:00.000Z', ref: 'v1.4.2' }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ deploymentId: 'new', ref: 'v1.4.2' });
  });

  it('ignores whatever did not succeed', () => {
    // A failed deployment put nothing on the environment, so a version read
    // against it would report a mismatch that means nothing.
    const candidates = latestPerEnvironment([
      deployment({ id: 'ok', createdAt: '2026-07-30T10:00:00.000Z' }),
      deployment({ id: 'ko', createdAt: '2026-08-01T10:00:00.000Z', status: 'failure' }),
    ]);
    expect(candidates.map((c) => c.deploymentId)).toEqual(['ok']);
  });

  it('yields nothing when nothing succeeded', () => {
    expect(latestPerEnvironment([deployment({ status: 'failure' })])).toEqual([]);
  });

  it('keeps one entry per repo and environment', () => {
    const candidates = latestPerEnvironment([
      deployment({ id: 'a', repo: 'billing', environment: 'prod' }),
      deployment({ id: 'b', repo: 'portal', environment: 'prod' }),
      deployment({ id: 'c', repo: 'billing', environment: 'rec' }),
    ]);
    expect(candidates).toHaveLength(3);
  });

  it('carries what addressing the environment needs', () => {
    const [candidate] = latestPerEnvironment([
      deployment({ environmentUrl: 'https://billing.example.com', attributes: { client: 'acme' } }),
    ]);
    expect(candidate).toMatchObject({
      environmentUrl: 'https://billing.example.com',
      attributes: { client: 'acme' },
    });
  });
});

describe('withDeclared', () => {
  const declared = {
    repo: '',
    environment: 'contoso-onsite',
    url: 'https://contoso.example.test',
    attributes: { client: 'contoso' },
  };

  it('makes a candidate of an environment nothing deploys to', () => {
    const [, added] = withDeclared([candidate()], [declared]);

    // No deployment, therefore no ref, no id, and nothing to freeze a reading
    // against — the reading is still the only way anyone learns what it runs.
    expect(added).toMatchObject({
      environment: 'contoso-onsite',
      repo: '',
      deploymentId: null,
      ref: null,
      deployedAt: null,
      environmentUrl: 'https://contoso.example.test',
      attributes: { client: 'contoso' },
    });
  });

  it('adds nothing where a deployment already speaks for the pair', () => {
    const deployed = candidate();
    const candidates = withDeclared(
      [deployed],
      [{ ...declared, repo: deployed.repo, environment: deployed.environment }],
    );

    // The deployed candidate knows the ref and the deployment id this one never
    // will; the declaration had its say when the address was decided.
    expect(candidates).toEqual([deployed]);
  });

  it('keeps a declaration that states no address', () => {
    // A rule can still address it by name, and the reading filed against it is
    // what tells its author that none could.
    const [added] = withDeclared([], [{ ...declared, url: null }]);
    expect(added.environmentUrl).toBeNull();
  });
});
