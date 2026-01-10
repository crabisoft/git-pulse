import { describe, expect, it } from 'vitest';
import type { DashboardEnvironment, PipelineStatus } from '@repo/shared';
import { defaultGroupBy, groupEnvironments, UNCLASSIFIED } from './grouping';

function env(
  name: string,
  attributes: Record<string, string>,
  lastStatus: PipelineStatus = 'success',
): DashboardEnvironment {
  return {
    name,
    attributes,
    metaEnvironments: [],
    repos: ['acme/api'],
    deployments: 3,
    lastDeployAt: '2026-07-30T10:00:00.000Z',
    lastStatus,
    ref: 'v2.14.1',
    recent: ['success'],
  };
}

describe('groupEnvironments', () => {
  it('folds on the dimension asked for', () => {
    const groups = groupEnvironments(
      [
        env('prod-acme-api', { client: 'acme', app: 'api' }),
        env('prod-globex-api', { client: 'globex', app: 'api' }),
        env('prod-acme-web', { client: 'acme', app: 'web' }),
      ],
      'client',
    );

    expect(groups.map((g) => g.key)).toEqual(['acme', 'globex']);
    expect(groups[0].environments.map((e) => e.name)).toEqual(['prod-acme-api', 'prod-acme-web']);
  });

  it('reads the same data differently depending on the fold', () => {
    // The point of the control: one board, two stories.
    const environments = [
      env('prod-acme-api', { client: 'acme', app: 'api' }),
      env('prod-globex-api', { client: 'globex', app: 'api' }),
    ];
    expect(groupEnvironments(environments, 'app').map((g) => g.key)).toEqual(['api']);
    expect(groupEnvironments(environments, 'client').map((g) => g.key)).toEqual(['acme', 'globex']);
  });

  it('keeps what the dimension says nothing about, last', () => {
    // Dropping it would hide the rule that is missing, which is the one thing
    // the reader could act on.
    const groups = groupEnvironments(
      [env('qa-web', { app: 'web' }), env('prod-acme-api', { client: 'acme' })],
      'client',
    );

    expect(groups.map((g) => g.key)).toEqual(['acme', UNCLASSIFIED]);
    expect(groups[1].environments.map((e) => e.name)).toEqual(['qa-web']);
  });

  it('counts what needs attention per group', () => {
    const groups = groupEnvironments(
      [
        env('prod-acme-api', { client: 'acme' }, 'failed'),
        env('prod-acme-web', { client: 'acme' }),
        env('prod-globex-api', { client: 'globex' }),
      ],
      'client',
    );

    expect(groups[0].alerts).toBe(1);
    expect(groups[1].alerts).toBe(0);
  });

  it('keeps the board flat when nothing is being folded on', () => {
    const groups = groupEnvironments([env('a', {}), env('b', {})], null);
    expect(groups).toHaveLength(1);
    expect(groups[0].environments).toHaveLength(2);
  });

  it('has no group to show for no environment', () => {
    expect(groupEnvironments([], null)).toEqual([]);
    expect(groupEnvironments([], 'client')).toEqual([]);
  });
});

describe('defaultGroupBy', () => {
  const dimensions = { app: ['api', 'jobs', 'web'], client: ['a', 'b'], type: ['prod'] };

  it('leaves a short board alone', () => {
    // Folding four rows hides more than it shortens.
    expect(defaultGroupBy(dimensions, 4)).toBeNull();
  });

  it('folds a long board on its coarsest dimension', () => {
    // Two groups worth reading, rather than ten groups of three.
    expect(defaultGroupBy(dimensions, 30)).toBe('client');
  });

  it('ignores a dimension that would make one group of everything', () => {
    expect(defaultGroupBy({ type: ['prod'] }, 30)).toBeNull();
  });

  it('folds on nothing when the rules extracted nothing', () => {
    expect(defaultGroupBy({}, 30)).toBeNull();
  });
});
