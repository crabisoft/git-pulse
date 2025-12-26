import { describe, expect, it } from 'vitest';
import type { ClassifiedDeployment, PipelineStatus } from '@repo/shared';
import { META_KEY, applyFilters, byMostRecent, previousDeployment, vocabularies } from './filter';

function deployment(over: Partial<ClassifiedDeployment> = {}): ClassifiedDeployment {
  return {
    id: 'd1',
    repo: 'extranet-api',
    environment: 'prod-eu',
    ref: 'main',
    status: 'success',
    createdAt: '2026-01-10T10:00:00.000Z',
    environmentUrl: null,
    url: null,
    refUrl: 'https://github.com/acme/extranet-api/tree/main',
    attributes: { type: 'Prod', region: 'eu' },
    metaEnvironments: ['Production'],
    ...over,
  };
}

describe('vocabularies', () => {
  it('collects every environment, status and attribute seen', () => {
    const vocabulary = vocabularies([
      deployment(),
      deployment({ id: 'd2', environment: 'staging', status: 'failed', attributes: { type: 'Staging' } }),
    ]);

    expect(vocabulary.environments).toEqual(['prod-eu', 'staging']);
    expect(vocabulary.statuses).toEqual(['failed', 'success']);
    expect(vocabulary.dimensions.type).toEqual(['Prod', 'Staging']);
    expect(vocabulary.dimensions.region).toEqual(['eu']);
  });

  it('offers meta-environments under a key no rule can produce', () => {
    // A rule extracting an attribute literally named `meta` is plausible; one
    // extracting `@meta` is not, which is the whole point of the prefix.
    const vocabulary = vocabularies([deployment()]);
    expect(vocabulary.dimensions[META_KEY]).toEqual(['Production']);
    expect(META_KEY.startsWith('@')).toBe(true);
  });

  it('says nothing about a deployment no rule matched', () => {
    const vocabulary = vocabularies([
      deployment({ attributes: {}, metaEnvironments: [] }),
    ]);
    expect(vocabulary.dimensions).toEqual({});
    // The environment is still offered: an unclassified one is still a place
    // things were deployed to.
    expect(vocabulary.environments).toEqual(['prod-eu']);
  });
});

describe('applyFilters', () => {
  const rows = [
    deployment({ id: 'd1', environment: 'prod-eu', status: 'success' }),
    deployment({ id: 'd2', environment: 'prod-us', status: 'failed', attributes: { type: 'Prod', region: 'us' } }),
    deployment({ id: 'd3', environment: 'staging', status: 'success', attributes: { type: 'Staging' }, metaEnvironments: [] }),
  ];

  it('keeps everything when no filter is set', () => {
    expect(applyFilters(rows, {}).map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('reads an empty selection as "every one", not as "none"', () => {
    expect(applyFilters(rows, { environments: [], statuses: [] })).toHaveLength(3);
  });

  it('matches any of the selected environments', () => {
    expect(applyFilters(rows, { environments: ['prod-eu', 'staging'] }).map((d) => d.id)).toEqual([
      'd1',
      'd3',
    ]);
  });

  it('requires every dimension pair to match, not any of them', () => {
    const kept = applyFilters(rows, { dimensions: { type: 'Prod', region: 'us' } });
    expect(kept.map((d) => d.id)).toEqual(['d2']);
  });

  it('filters on a meta-environment through its own key', () => {
    expect(applyFilters(rows, { dimensions: { [META_KEY]: 'Production' } }).map((d) => d.id)).toEqual([
      'd1',
      'd2',
    ]);
  });

  it('combines filters of different kinds', () => {
    const kept = applyFilters(rows, {
      statuses: ['success' as PipelineStatus],
      dimensions: { type: 'Prod' },
    });
    expect(kept.map((d) => d.id)).toEqual(['d1']);
  });
});

describe('byMostRecent', () => {
  it('puts the latest deployment first', () => {
    const rows = [
      deployment({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      deployment({ id: 'new', createdAt: '2026-02-01T00:00:00.000Z' }),
    ];
    expect([...rows].sort(byMostRecent).map((d) => d.id)).toEqual(['new', 'old']);
  });
});

describe('previousDeployment', () => {
  const target = deployment({ id: 'target', createdAt: '2026-01-10T10:00:00.000Z' });

  it('takes the closest earlier success in the same repo and environment', () => {
    const rows = [
      target,
      deployment({ id: 'older', createdAt: '2026-01-01T00:00:00.000Z', ref: 'v1' }),
      deployment({ id: 'closer', createdAt: '2026-01-09T00:00:00.000Z', ref: 'v2' }),
    ];
    expect(previousDeployment(rows, target)?.id).toBe('closer');
  });

  it('skips a failed deployment', () => {
    // Comparing against one would report what was attempted, not what runs —
    // and a run of failures would make every one of them look empty.
    const rows = [
      target,
      deployment({ id: 'failed', createdAt: '2026-01-09T00:00:00.000Z', status: 'failed' }),
      deployment({ id: 'success', createdAt: '2026-01-05T00:00:00.000Z' }),
    ];
    expect(previousDeployment(rows, target)?.id).toBe('success');
  });

  it('ignores another environment, however recent', () => {
    const rows = [
      target,
      deployment({ id: 'staging', environment: 'staging', createdAt: '2026-01-09T00:00:00.000Z' }),
    ];
    expect(previousDeployment(rows, target)).toBeNull();
  });

  it('ignores another repo', () => {
    const rows = [
      target,
      deployment({ id: 'other', repo: 'web', createdAt: '2026-01-09T00:00:00.000Z' }),
    ];
    expect(previousDeployment(rows, target)).toBeNull();
  });

  it('never looks forward in time', () => {
    const rows = [
      target,
      deployment({ id: 'later', createdAt: '2026-01-20T00:00:00.000Z' }),
    ];
    expect(previousDeployment(rows, target)).toBeNull();
  });

  it('answers null for a first deployment rather than pointing at itself', () => {
    expect(previousDeployment([target], target)).toBeNull();
  });
});
