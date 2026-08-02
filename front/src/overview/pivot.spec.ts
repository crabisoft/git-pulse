import { describe, expect, it } from 'vitest';
import type { DashboardEnvironment } from '@repo/shared';
import { pivotEnvironments } from './pivot';
import { defaultAxes } from './axes';
import { UNCLASSIFIED } from './grouping';

function env(
  name: string,
  attributes: Record<string, string>,
  lastDeployAt = '2026-07-30T10:00:00.000Z',
): DashboardEnvironment {
  return {
    name,
    attributes,
    metaEnvironments: [],
    repos: ['acme/api'],
    deployments: 2,
    lastDeployAt,
    lastStatus: 'success',
    ref: 'v2.14.1',
    declared: false,
    recent: ['success'],
  };
}

describe('pivotEnvironments', () => {
  it('crosses the two dimensions asked for', () => {
    const { rows, columns, cells } = pivotEnvironments(
      [
        env('prod-acme-api', { client: 'acme', app: 'api' }),
        env('prod-globex-web', { client: 'globex', app: 'web' }),
      ],
      'client',
      'app',
    );

    expect(rows).toEqual(['acme', 'globex']);
    expect(columns).toEqual(['api', 'web']);
    expect(cells).toHaveLength(4);
  });

  it('keeps a crossing that does not exist as an empty cell', () => {
    // "This client has no jobs environment" is an answer, and a grid with
    // holes punched out of it stops being alignable.
    const { cells } = pivotEnvironments(
      [env('prod-acme-api', { client: 'acme', app: 'api' })],
      'client',
      'app',
    );
    expect(cells).toHaveLength(1);
    expect(cells[0].environment?.name).toBe('prod-acme-api');
  });

  it('reports what is running now when a crossing holds several', () => {
    const { cells } = pivotEnvironments(
      [
        env('prod-acme-api-blue', { client: 'acme', app: 'api' }, '2026-07-01T10:00:00.000Z'),
        env('prod-acme-api-green', { client: 'acme', app: 'api' }, '2026-07-30T10:00:00.000Z'),
      ],
      'client',
      'app',
    );
    expect(cells[0].environment?.name).toBe('prod-acme-api-green');
  });

  it('hands the cell what it is standing in front of, newest first', () => {
    // Four dimensions crossed two at a time leaves two collapsed: without
    // this, picking a pair of axes hides environments and says nothing.
    const { cells } = pivotEnvironments(
      [
        env('ProdContosoBilling', { Env: 'Prod', App: 'Billing' }, '2026-07-28T10:00:00.000Z'),
        env('ProdGlobexBilling', { Env: 'Prod', App: 'Billing' }, '2026-07-30T10:00:00.000Z'),
        env('ProdFabrikamBilling', { Env: 'Prod', App: 'Billing' }, '2026-07-29T10:00:00.000Z'),
      ],
      'Env',
      'App',
    );

    expect(cells[0].environment?.name).toBe('ProdGlobexBilling');
    expect(cells[0].others.map((e) => e.name)).toEqual([
      'ProdFabrikamBilling',
      'ProdContosoBilling',
    ]);
  });

  it('leaves a crossing of one with nothing behind it', () => {
    const { cells } = pivotEnvironments(
      [env('prod-acme-api', { client: 'acme', app: 'api' })],
      'client',
      'app',
    );
    expect(cells[0].others).toEqual([]);
  });

  it('separates them again once a discriminating axis is crossed', () => {
    const { cells } = pivotEnvironments(
      [
        env('ProdContosoBilling', { Customer: 'Contoso', App: 'Billing' }),
        env('ProdGlobexBilling', { Customer: 'Globex', App: 'Billing' }),
      ],
      'Customer',
      'App',
    );

    expect(cells.every((c) => c.others.length === 0)).toBe(true);
  });

  it('puts what the rules did not classify last, and keeps it', () => {
    const { rows } = pivotEnvironments(
      [env('qa-web', { app: 'web' }), env('prod-acme-web', { client: 'acme', app: 'web' })],
      'client',
      'app',
    );
    expect(rows).toEqual(['acme', UNCLASSIFIED]);
  });
});

describe('defaultAxes', () => {
  it('crosses the two dimensions that spread the data', () => {
    // The opposite of what the board folds on: an axis with a single value is
    // a grid one cell across, which says less than the list it replaced.
    expect(defaultAxes({ client: ['a', 'b', 'c'], type: ['prod', 'preprod'], app: ['api'] })).toEqual({
      rows: 'client',
      columns: 'type',
    });
  });

  it('still crosses something when only one dimension is wide', () => {
    expect(defaultAxes({ app: ['api'], client: ['acme', 'globex'], type: ['prod'] })).toEqual({
      rows: 'client',
      columns: 'app',
    });
  });

  it('has nothing to cross below two dimensions', () => {
    expect(defaultAxes({ type: ['prod'] })).toBeNull();
    expect(defaultAxes({})).toBeNull();
  });
});
