import { describe, expect, it } from 'vitest';
import type { FailureSource } from '@repo/shared';
import {
  changeFailureRate,
  deploymentFrequency,
  leadTimeBreakdown,
  mttr,
  orphanIncidentDimensions,
  type DeploymentEvent,
  type IncidentEvent,
  type MergedPrEvent,
} from './dora-metrics';

const PROD = { type: 'Prod' };
const STAGING = { type: 'Staging' };

const deploy = (
  at: string,
  status: DeploymentEvent['status'],
  dimensions: Record<string, string> = PROD,
  environment = 'prod',
): DeploymentEvent => ({ environment, repo: 'api', status, createdAt: at, dimensions });

const incident = (
  openedAt: string,
  resolvedAt: string | null,
  dimensions: Record<string, string> = PROD,
): IncidentEvent => ({
  key: '#1',
  title: 'outage',
  url: 'https://tracker/1',
  openedAt,
  resolvedAt,
  dimensions,
});

const pr = (over: Partial<MergedPrEvent> = {}): MergedPrEvent => ({
  repo: 'api',
  number: 1,
  url: 'https://host/pr/1',
  firstCommitAt: '2026-01-01T00:00:00Z',
  openedAt: '2026-01-01T01:00:00Z',
  firstReviewAt: '2026-01-01T02:00:00Z',
  mergedAt: '2026-01-01T04:00:00Z',
  tickets: [],
  dimensions: PROD,
  ...over,
});

/** Four deployments in prod, one of them failed. */
const deployments = [
  deploy('2026-01-01T00:00:00Z', 'success'),
  deploy('2026-01-02T00:00:00Z', 'failed'),
  deploy('2026-01-02T01:00:00Z', 'success'),
  deploy('2026-01-03T00:00:00Z', 'success'),
];
const incidents = [incident('2026-01-04T00:00:00Z', '2026-01-04T02:00:00Z')];

const rate = (source: FailureSource) => changeFailureRate(deployments, incidents, source)[0].value;
const restore = (source: FailureSource) => {
  const [result] = mttr(deployments, incidents, source);
  return { value: result.value, sampleSize: result.sampleSize };
};

describe('deploymentFrequency', () => {
  it('counts deployments per dimension combination', () => {
    const results = deploymentFrequency([...deployments, deploy('2026-01-05T00:00:00Z', 'success', STAGING)]);
    expect(results.map((r) => [r.dimensions.type, r.value])).toEqual([
      ['Prod', 4],
      ['Staging', 1],
    ]);
  });
});

describe('changeFailureRate', () => {
  it('counts failed deployments when failures come from pipelines', () => {
    expect(rate('pipelines')).toBe(0.25);
  });

  it('counts incidents, still over the deployment count', () => {
    expect(rate('incidents')).toBe(0.25);
  });

  it('adds both signals without deduplicating them', () => {
    expect(rate('both')).toBe(0.5);
  });

  it('ignores deployments whose status could not be read', () => {
    const withUnknown = [...deployments, deploy('2026-01-06T00:00:00Z', 'other')];
    // Still 1 failure over 4 known deployments, not over 5.
    expect(changeFailureRate(withUnknown, [], 'pipelines')[0].value).toBe(0.25);
  });

  it('emits nothing for a slice that never deployed', () => {
    const misaligned = [incident('2026-01-04T00:00:00Z', null, STAGING)];
    const dimensions = changeFailureRate(deployments, misaligned, 'incidents').map(
      (r) => r.dimensions,
    );
    expect(dimensions).toEqual([PROD]);
  });

  it('shows the contributing failures first in the samples', () => {
    const [result] = changeFailureRate(deployments, incidents, 'both');
    expect(result.samples[0].status).toBe('failed');
  });
});

describe('orphanIncidentDimensions', () => {
  it('surfaces the slices that carry incidents but no deployment', () => {
    const misaligned = [incident('2026-01-04T00:00:00Z', null, STAGING)];
    expect(orphanIncidentDimensions(deployments, misaligned)).toEqual([STAGING]);
  });

  it('says nothing when every incident has a denominator', () => {
    expect(orphanIncidentDimensions(deployments, incidents)).toEqual([]);
  });
});

describe('mttr', () => {
  it('measures a failed deployment until the next success in the same environment', () => {
    expect(restore('pipelines')).toEqual({ value: 3600, sampleSize: 1 });
  });

  it('measures an incident from opened to resolved', () => {
    expect(restore('incidents')).toEqual({ value: 7200, sampleSize: 1 });
  });

  it('takes the median over the union of both signals', () => {
    expect(restore('both')).toEqual({ value: 5400, sampleSize: 2 });
  });

  it('leaves an unresolved incident out rather than counting it as zero', () => {
    const [result] = mttr([], [incident('2026-01-05T00:00:00Z', null)], 'incidents');
    expect(result.sampleSize).toBe(0);
  });

  it('reports a slice known only through its incidents', () => {
    const elsewhere = [incident('2026-01-04T00:00:00Z', '2026-01-04T01:00:00Z', STAGING)];
    const types = mttr(deployments, elsewhere, 'both')
      .map((r) => r.dimensions.type)
      .sort();
    expect(types).toEqual(['Prod', 'Staging']);
  });

  it('ignores a failure never followed by a success', () => {
    const stillDown = [deploy('2026-01-01T00:00:00Z', 'failed')];
    expect(mttr(stillDown, [], 'pipelines')[0].sampleSize).toBe(0);
  });
});

describe('leadTimeBreakdown', () => {
  it('splits the lead time into coding, pickup and review', () => {
    const byMetric = Object.fromEntries(
      leadTimeBreakdown([pr()]).map((r) => [r.metric, r.value]),
    );
    expect(byMetric).toEqual({
      coding_time: 3600, // first commit → opened
      pickup_time: 3600, // opened → first review
      review_time: 7200, // first review → merged
      lead_time: 14400, // first commit → merged
    });
  });

  it('clamps a negative duration instead of subtracting from the median', () => {
    const backdated = pr({ firstCommitAt: '2026-01-01T02:00:00Z', openedAt: '2026-01-01T00:00:00Z' });
    const coding = leadTimeBreakdown([backdated]).find((r) => r.metric === 'coding_time');
    expect(coding?.value).toBe(0);
  });

  it('skips pickup and review when the platform exposes no review', () => {
    const noReview = leadTimeBreakdown([pr({ firstReviewAt: null })]);
    const sizes = Object.fromEntries(noReview.map((r) => [r.metric, r.sampleSize]));
    expect(sizes.pickup_time).toBe(0);
    expect(sizes.review_time).toBe(0);
    // The lead time itself is unaffected: it needs no review.
    expect(sizes.lead_time).toBe(1);
  });

  it('takes the median, not the mean, so one outlier does not carry the value', () => {
    const fast = pr({ mergedAt: '2026-01-01T02:00:00Z' });
    const slow = pr({ mergedAt: '2026-01-11T00:00:00Z' });
    const median = pr({ mergedAt: '2026-01-01T05:00:00Z' });
    const lead = leadTimeBreakdown([fast, slow, median]).find((r) => r.metric === 'lead_time');
    expect(lead?.value).toBe(18000); // the middle one, 5h
  });
});
