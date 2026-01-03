import { describe, expect, it } from 'vitest';
import type { ClassifiedDeployment, PipelineStatus } from '@repo/shared';
import { selectPending } from './pending';

function deployment(
  id: string,
  createdAt: string,
  status: PipelineStatus = 'success',
): ClassifiedDeployment {
  return {
    id,
    repo: 'widget',
    environment: 'prod',
    ref: `v-${id}`,
    status,
    createdAt,
    environmentUrl: null,
    url: null,
    attributes: {},
    metaEnvironments: [],
    refUrl: `https://github.com/acme/widget/tree/v-${id}`,
  };
}

describe('selectPending', () => {
  it('leaves out the deployments already filed', () => {
    const { targets, known } = selectPending(
      [deployment('a', '2026-07-01T10:00:00Z'), deployment('b', '2026-07-02T10:00:00Z')],
      new Set(['a']),
    );

    expect(targets.map((d) => d.id)).toEqual(['b']);
    expect(known).toBe(1);
  });

  it('files nothing for a deployment that did not succeed', () => {
    const { targets } = selectPending(
      [
        deployment('ko', '2026-07-01T10:00:00Z', 'failed'),
        deployment('run', '2026-07-02T10:00:00Z', 'running'),
        deployment('ok', '2026-07-03T10:00:00Z'),
      ],
      new Set(),
    );

    expect(targets.map((d) => d.id)).toEqual(['ok']);
  });

  it('takes the oldest first, so a backlog is worked from the end closest to expiring', () => {
    const { targets, deferred } = selectPending(
      [
        deployment('new', '2026-07-20T10:00:00Z'),
        deployment('old', '2026-07-01T10:00:00Z'),
        deployment('mid', '2026-07-10T10:00:00Z'),
      ],
      new Set(),
      2,
    );

    expect(targets.map((d) => d.id)).toEqual(['old', 'mid']);
    expect(deferred).toBe(1);
  });

  it('defers nothing when the batch covers everything left', () => {
    const { targets, deferred } = selectPending([deployment('a', '2026-07-01T10:00:00Z')], new Set(), 5);

    expect(targets).toHaveLength(1);
    expect(deferred).toBe(0);
  });
});
