import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleTarget } from '@repo/shared';
import { subjectKey, type ClassifySubject } from '../env-rules/env-rules.service';
import { DoraService } from './dora.service';

/**
 * Which dimensions each metric can be sliced by.
 *
 * A dimension is an attribute of the events a metric is measured on, and the
 * two families are classified by different rules: a deployment by the
 * environment ones, a merged pull request by its own. So a key stated on one
 * side only narrows half the metrics and empties the other half — which the
 * union vocabulary the filter bar is built from cannot say, and which a detail
 * page showing exactly one metric has to.
 */

const SOURCE_ID = 'src-1';
const NOW = '2026-08-01T12:00:00.000Z';

const DEPLOYMENT = {
  id: 'd-1',
  repo: 'api',
  environment: 'Prod',
  ref: 'v1',
  status: 'success' as const,
  createdAt: '2026-07-28T10:00:00.000Z',
  environmentUrl: null,
  url: null,
};

const MERGED_PR = {
  id: 'gh:api:42',
  repo: 'api',
  number: 42,
  title: 'feat: le sélecteur',
  body: '',
  url: 'https://github.com/acme/api/pull/42',
  headRef: 'feat/picker',
  openedAt: '2026-07-20T08:00:00.000Z',
  firstCommitAt: '2026-07-19T17:00:00.000Z',
  firstReviewAt: '2026-07-22T09:00:00.000Z',
  mergedAt: '2026-07-26T10:00:00.000Z',
  labels: [],
};

/** Deployments classified by environment, pull requests by repository name. */
function service() {
  const answers: Partial<Record<RuleTarget, Record<string, Record<string, string>>>> = {
    environment: { Prod: { type: 'prod' } },
    repository: { api: { app: 'portal' } },
  };
  const reader = {
    mode: 'stored',
    scope: { owner: 'acme' },
    listRepositories: vi.fn().mockResolvedValue(['api']),
    listDeployments: vi.fn().mockResolvedValue([DEPLOYMENT]),
    listMergedPullRequests: vi.fn().mockResolvedValue([MERGED_PR]),
  };

  return new DoraService(
    {} as never,
    {} as never,
    { for: vi.fn().mockResolvedValue(reader) } as never,
    {} as never,
    { incidentTrackerFor: vi.fn().mockResolvedValue(null) } as never,
    {
      classifyByPair: vi
        .fn()
        .mockImplementation((_id: string, subjects: ClassifySubject[], target: RuleTarget) =>
          Promise.resolve(
            new Map(
              subjects.map((subject) => [
                subjectKey(subject),
                {
                  name: subject.name,
                  attributes: (answers[target] ?? {})[subject.name] ?? {},
                  metaEnvironments: [],
                },
              ]),
            ),
          ),
        ),
    } as never,
    {
      extractMany: vi.fn().mockImplementation((_id, texts: unknown[]) => texts.map(() => [])),
    } as never,
    {
      get: vi.fn().mockResolvedValue({
        doraWindowDays: 30,
        failureSource: 'pipelines',
        incidentLabels: [],
        componentAttribute: null,
      }),
    } as never,
  );
}

beforeEach(() => {
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the vocabulary a report hands its filter bar', () => {
  it('offers the union of every key any metric carries', async () => {
    const report = await service().report(SOURCE_ID, {});

    expect(report.dimensions).toEqual({ app: ['portal'], type: ['prod'] });
  });

  it('states, per metric, which of them actually slice it', async () => {
    const report = await service().report(SOURCE_ID, {});

    expect(report.dimensionsByMetric.deployment_frequency).toEqual({ type: ['prod'] });
    expect(report.dimensionsByMetric.lead_time).toEqual({ app: ['portal'] });
  });

  it('collects it before slicing, so a filtered report can still widen back', async () => {
    const report = await service().report(SOURCE_ID, { dimensions: { type: 'prod' } });

    expect(report.dimensionsByMetric.lead_time).toEqual({ app: ['portal'] });
  });

  it('names no metric that has no reading at all', async () => {
    // Absent is not the same answer as empty: nothing was measured, so no
    // widening of any key would bring the metric back.
    const report = await service().report(SOURCE_ID, {});

    expect(report.dimensionsByMetric.mttr).toBeUndefined();
  });

  it('is what tells an emptied metric from a period with nothing in it', async () => {
    // The behaviour the vocabulary exists to explain: a key the pull requests
    // never carry leaves the lead time with no reading at all.
    const report = await service().report(SOURCE_ID, { dimensions: { type: 'prod' } });

    expect(report.results.map((r) => r.metric)).not.toContain('lead_time');
    expect(report.results.map((r) => r.metric)).toContain('deployment_frequency');
  });
});
