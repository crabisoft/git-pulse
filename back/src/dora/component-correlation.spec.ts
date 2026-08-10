import { describe, expect, it } from 'vitest';
import {
  carriedBy,
  componentMismatches,
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

/** What the request was paired with — the specs state events, not the index. */
const carried = (request: MergedPrEvent, of: DeploymentEvent[], componentKey: string | null = null) =>
  carriedBy([request], of, componentKey).get(request) ?? [];

/** Both correlations the report compares: narrowed, and repo-and-time alone. */
const mismatches = (prs: MergedPrEvent[], of: DeploymentEvent[], componentKey: string | null) =>
  componentMismatches(prs, carriedBy(prs, of, componentKey), carriedBy(prs, of), componentKey);

describe('correlating a merged request with the deployment that carried it', () => {
  const front = deploy('2026-01-01T06:00:00Z', { component: 'front', type: 'Prod' });
  const back = deploy('2026-01-01T02:00:00Z', { component: 'back', type: 'Prod' });

  it('pairs a request with the earliest deployment of its repo, as it always did', () => {
    expect(carried(pr({ component: 'front' }), [front, back])).toEqual([back]);
  });

  it('skips the components the request did not touch once one is designated', () => {
    expect(carried(pr({ component: 'front' }), [front, back], 'component')).toEqual([front]);
  });

  it('measures the release of that component rather than the one before it', () => {
    const request = pr({ component: 'front' });
    const [reading] = deployTime([request], carriedBy([request], [front, back], 'component'));

    // Six hours to the front-end release, not the two to the back-end one.
    expect(reading.value).toBe(6 * 3600);
  });

  it('falls back to repo and time where the deployment names no component', () => {
    const plain = deploy('2026-01-01T02:00:00Z', { type: 'Prod' });

    expect(carried(pr({ component: 'front' }), [plain], 'component')).toEqual([plain]);
  });

  it('falls back the same way where the request names none', () => {
    expect(carried(pr({}), [front, back], 'component')).toEqual([back]);
  });

  describe('a release naming a component and one naming none', () => {
    // Two runs to compare rather than one: a deployment silent about the
    // deployable pairs with any request, so it can be the earlier of the two —
    // and the index reads them as two sorted lists, not as one.
    it('takes the silent release when it landed first', () => {
      const silent = deploy('2026-01-01T04:00:00Z', { type: 'Prod' });

      expect(carried(pr({ component: 'front' }), [front, silent], 'component')).toEqual([silent]);
    });

    it("takes the component's own release when that one landed first", () => {
      const silent = deploy('2026-01-01T08:00:00Z', { type: 'Prod' });

      expect(carried(pr({ component: 'front' }), [front, silent], 'component')).toEqual([front]);
    });

    it('never takes a release of another component, whenever it landed', () => {
      const early = deploy('2026-01-01T01:00:00Z', { component: 'back', type: 'Prod' });

      expect(carried(pr({ component: 'front' }), [front, early], 'component')).toEqual([front]);
    });
  });

  it('leaves an ordinary repo untouched, both sides being silent', () => {
    const ordinary = { ...deploy('2026-01-01T02:00:00Z', { type: 'Prod' }), repo: 'api' };
    const request = { ...pr({ type: 'Prod' }), repo: 'api' };

    expect(carried(request, [ordinary], 'component')).toEqual(carried(request, [ordinary]));
  });
});

describe('what the component test can empty, and how it says so', () => {
  const deployment = deploy('2026-01-01T02:00:00Z', { component: 'api' });

  it('reports a repo whose two sides name different deployables', () => {
    const requests = [pr({ component: 'backend' })];

    expect(mismatches(requests, [deployment], 'component')).toEqual([
      { repo: MONOREPO, component: 'backend' },
    ]);
  });

  it('reports nothing while the request agrees with the deployment', () => {
    expect(mismatches([pr({ component: 'api' })], [deployment], 'component')).toEqual([]);
  });

  it('reports nothing where the repo simply never deployed', () => {
    // Nothing to correlate with is not a disagreement, and the metric would be
    // empty for that repo whatever the rules said.
    expect(mismatches([pr({ component: 'backend' })], [], 'component')).toEqual([]);
  });

  it('reports nothing at all while no attribute is designated', () => {
    expect(mismatches([pr({ component: 'backend' })], [deployment], null)).toEqual([]);
  });
});
