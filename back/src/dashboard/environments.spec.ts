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

describe('declared environments', () => {
  const declared = { repo: '', environment: 'contoso-onsite', attributes: { client: 'contoso' } };

  it('gives an environment nothing deployed to a row of its own', () => {
    const rows = foldEnvironments([deployment()], [declared]);

    // It runs something and can be reached; what it has never had is a
    // deployment this install saw, and the row says so rather than inventing
    // one.
    expect(rows.map((r) => r.name)).toEqual(['Prod', 'contoso-onsite']);
    expect(rows[1]).toMatchObject({
      declared: true,
      deployments: 0,
      lastDeployAt: null,
      lastStatus: null,
      ref: null,
      repos: [],
      attributes: { client: 'contoso' },
    });
  });

  it('sorts every declared row after the deployed ones', () => {
    const rows = foldEnvironments(
      [deployment({ environment: 'Prod', createdAt: '2020-01-01T00:00:00.000Z' })],
      [declared],
    );
    expect(rows.map((r) => r.name)).toEqual(['Prod', 'contoso-onsite']);
  });

  it('leaves the deployed row alone when the same name is also declared', () => {
    // The row built from deployments says more — its repos, its count, its
    // heartbeat — and a second row of the same name would read as two
    // environments.
    const rows = foldEnvironments(
      [deployment({ environment: 'Prod' })],
      [{ repo: 'acme/api', environment: 'Prod', attributes: {} }],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Prod', declared: false, deployments: 1 });
  });

  it('folds a name declared under two repos into one row', () => {
    const rows = foldEnvironments(
      [],
      [
        { repo: 'acme/api', environment: 'onsite', attributes: {} },
        { repo: 'acme/web', environment: 'onsite', attributes: {} },
      ],
    );
    expect(rows).toHaveLength(1);
  });
});
