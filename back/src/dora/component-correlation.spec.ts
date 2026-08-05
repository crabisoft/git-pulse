import { describe, expect, it } from 'vitest';
import {
  componentMismatches,
  deploymentsCarrying,
  deployTime,
  type DeploymentEvent,
  type MergedPrEvent,
} from './dora-metrics';

/**
 * One repository holding two deployables, which is the whole difficulty: the
 * repo name no longer tells the front from the back, so correlating on it alone
 * hands a front-end change whichever release happened to go out first.
 */
const MONOREPO = 'platform';

const deploy = (
  at: string,
  dimensions: Record<string, string>,
  environment = 'prod',
): DeploymentEvent => ({
  environment,
  repo: MONOREPO,
  status: 'success',
  createdAt: at,
  dimensions,
});

const pr = (dimensions: Record<string, string>, mergedAt = '2026-01-01T00:00:00Z'): MergedPrEvent => ({
  repo: MONOREPO,
  number: 1,
  url: 'https://host/pr/1',
  firstCommitAt: '2025-12-31T00:00:00Z',
  openedAt: '2025-12-31T12:00:00Z',
  firstReviewAt: '2025-12-31T18:00:00Z',
  mergedAt,
  tickets: [],
  dimensions,
});

describe('correlating a merged request with the deployment that carried it', () => {
  const front = deploy('2026-01-01T06:00:00Z', { component: 'front', type: 'Prod' });
  const back = deploy('2026-01-01T02:00:00Z', { component: 'back', type: 'Prod' });

  it('pairs a request with the earliest deployment of its repo, as it always did', () => {
    const carried = deploymentsCarrying(pr({ component: 'front' }), [front, back]);

    expect(carried).toEqual([back]);
  });

  it('skips the components the request did not touch once one is designated', () => {
    const carried = deploymentsCarrying(pr({ component: 'front' }), [front, back], 'component');

    expect(carried).toEqual([front]);
  });

  it('measures the release of that component rather than the one before it', () => {
    const [reading] = deployTime([pr({ component: 'front' })], [front, back], 'component');

    // Six hours to the front-end release, not the two to the back-end one.
    expect(reading.value).toBe(6 * 3600);
  });

  it('falls back to repo and time where the deployment names no component', () => {
    const plain = deploy('2026-01-01T02:00:00Z', { type: 'Prod' });

    const carried = deploymentsCarrying(pr({ component: 'front' }), [plain], 'component');

    expect(carried).toEqual([plain]);
  });

  it('falls back the same way where the request names none', () => {
    const carried = deploymentsCarrying(pr({}), [front, back], 'component');

    expect(carried).toEqual([back]);
  });

  it('leaves an ordinary repo untouched, both sides being silent', () => {
    const ordinary = { ...deploy('2026-01-01T02:00:00Z', { type: 'Prod' }), repo: 'api' };
    const request = { ...pr({ type: 'Prod' }), repo: 'api' };

    expect(deploymentsCarrying(request, [ordinary], 'component')).toEqual(
      deploymentsCarrying(request, [ordinary]),
    );
  });
});

describe('what the component test can empty, and how it says so', () => {
  const deployment = deploy('2026-01-01T02:00:00Z', { component: 'api' });

  it('reports a repo whose two sides name different deployables', () => {
    const requests = [pr({ component: 'backend' })];

    expect(componentMismatches(requests, [deployment], 'component')).toEqual([
      { repo: MONOREPO, component: 'backend' },
    ]);
  });

  it('reports nothing while the request agrees with the deployment', () => {
    expect(componentMismatches([pr({ component: 'api' })], [deployment], 'component')).toEqual([]);
  });

  it('reports nothing where the repo simply never deployed', () => {
    // Nothing to correlate with is not a disagreement, and the metric would be
    // empty for that repo whatever the rules said.
    expect(componentMismatches([pr({ component: 'backend' })], [], 'component')).toEqual([]);
  });

  it('reports nothing at all while no attribute is designated', () => {
    expect(componentMismatches([pr({ component: 'backend' })], [deployment], null)).toEqual([]);
  });
});
