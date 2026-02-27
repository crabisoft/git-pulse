import { describe, expect, it } from 'vitest';
import type { PipelineStatus } from '@repo/shared';
import { foldEnvironments, type DimensionedDeployment } from './environments';

function deployment(over: Partial<DimensionedDeployment> = {}): DimensionedDeployment {
  return {
    id: `${over.repo ?? 'acme/api'}-${over.createdAt ?? '2026-07-30T10:00:00.000Z'}`,
    repo: 'acme/api',
    environment: 'Prod',
    ref: 'v2.14.1',
    status: 'success' as PipelineStatus,
    createdAt: '2026-07-30T10:00:00.000Z',
    environmentUrl: null,
    url: null,
    attributes: {},
    metaEnvironments: [],
    ...over,
  };
}

describe('foldEnvironments', () => {
  it('folds one row per name, most recently deployed first', () => {
    const rows = foldEnvironments([
      deployment({ environment: 'Preprod', createdAt: '2026-07-30T08:00:00.000Z' }),
      deployment({ environment: 'Prod', createdAt: '2026-07-30T11:00:00.000Z' }),
    ]);

    expect(rows.map((r) => r.name)).toEqual(['Prod', 'Preprod']);
  });

  it('reads what is running from the newest deployment of the row', () => {
    const rows = foldEnvironments([
      deployment({ createdAt: '2026-07-30T08:00:00.000Z', ref: 'v1', status: 'failed' }),
      deployment({ createdAt: '2026-07-30T11:00:00.000Z', ref: 'v2' }),
    ]);

    expect(rows[0]).toMatchObject({
      ref: 'v2',
      lastStatus: 'success',
      lastDeployAt: '2026-07-30T11:00:00.000Z',
      deployments: 2,
      // Oldest first: a run of failures and an isolated one read differently.
      recent: ['failed', 'success'],
    });
  });

  it('carries the attributes of a row whose deployments all agree', () => {
    const rows = foldEnvironments([
      deployment({ attributes: { Env: 'Prod', App: 'Billing' } }),
      deployment({ attributes: { Env: 'Prod', App: 'Billing' }, repo: 'acme/web' }),
    ]);

    expect(rows[0].attributes).toEqual({ Env: 'Prod', App: 'Billing' });
    expect(rows[0].repos).toEqual(['acme/api', 'acme/web']);
  });

  it('drops a key its repos answer differently rather than picking one', () => {
    const rows = foldEnvironments([
      deployment({ attributes: { Env: 'Prod', App: 'Billing' }, repo: 'a' }),
      deployment({ attributes: { Env: 'Prod', App: 'Portal' }, repo: 'b' }),
    ]);

    // A row claiming either App would be true of one repo and false of the
    // other; Env is the same either side.
    expect(rows[0].attributes).toEqual({ Env: 'Prod' });
  });

  it('keeps a key only one of them answers — silence is not disagreement', () => {
    const rows = foldEnvironments([
      deployment({ attributes: { Env: 'Prod', App: 'Billing' }, repo: 'a' }),
      deployment({ attributes: { Env: 'Prod' }, repo: 'b' }),
    ]);

    expect(rows[0].attributes).toEqual({ Env: 'Prod', App: 'Billing' });
  });

  it('keeps what one repo classified when no rule classifies the other at all', () => {
    // The regression this rule exists for: an environment deployed from a repo
    // outside every rule's reach emptied its own row, and a fully classified
    // environment landed under "unclassified" on both axes of the grid.
    const rows = foldEnvironments([
      deployment({ attributes: { Env: 'Preprod', Customer: 'Globex', App: 'Billing' }, repo: 'x-billing' }),
      deployment({ attributes: {}, repo: 'unruled' }),
    ]);

    expect(rows[0].attributes).toEqual({
      Env: 'Preprod',
      Customer: 'Globex',
      App: 'Billing',
    });
  });

  it('unions meta-environments, a set having no value to contradict', () => {
    const rows = foldEnvironments([
      deployment({ metaEnvironments: ['production', 'critique'], repo: 'a' }),
      deployment({ metaEnvironments: ['production'], repo: 'b' }),
    ]);

    expect(rows[0].metaEnvironments).toEqual(['critique', 'production']);
  });

  it('narrows with the deployments it is given, counts and repos together', () => {
    const all = [
      deployment({ attributes: { App: 'Billing' }, repo: 'a' }),
      deployment({ attributes: { App: 'Portal' }, repo: 'b' }),
      deployment({ attributes: { App: 'Portal' }, repo: 'b', createdAt: '2026-07-30T11:00:00.000Z' }),
    ];

    // What the overview does with a dimension filter: fold the survivors, not
    // the whole set patched afterwards.
    const rows = foldEnvironments(all.filter((d) => d.attributes.App === 'Portal'));

    expect(rows[0]).toMatchObject({
      attributes: { App: 'Portal' },
      repos: ['b'],
      deployments: 2,
    });
  });

  it('answers with nothing for no deployments at all', () => {
    expect(foldEnvironments([])).toEqual([]);
  });
});
