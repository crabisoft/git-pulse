import { describe, expect, it, vi } from 'vitest';
import type { Deployment } from '@repo/shared';
import { DeploymentsService } from './deployments.service';

function deployment(over: Partial<Deployment> = {}): Deployment {
  return {
    id: 'dep-1',
    repo: 'acme/api',
    environment: 'prod',
    ref: 'v1.4.2',
    status: 'success',
    createdAt: '2026-08-01T09:00:00.000Z',
    environmentUrl: null,
    url: null,
    ...over,
  };
}

/**
 * The service with everything it reads stubbed. Only the version half is under
 * test here — what the page needs to tell "no rules" from "rules, nothing read".
 */
function build(versions: {
  frozen?: unknown[];
  latest?: unknown[];
  rules?: number;
  deployments?: Deployment[];
  addresses?: { rules: unknown[]; declared: unknown[] };
}) {
  const store = {
    frozenFor: vi.fn().mockResolvedValue(versions.frozen ?? []),
    latest: vi.fn().mockResolvedValue(versions.latest ?? []),
    rulesAttached: vi.fn().mockResolvedValue(versions.rules ?? 0),
  };
  const service = new DeploymentsService(
    {
      for: vi.fn().mockResolvedValue({
        listRepositories: vi.fn().mockResolvedValue(['acme/api']),
        listDeployments: vi.fn().mockResolvedValue(versions.deployments ?? [deployment()]),
      }),
    } as never,
    {
      readSpec: vi
        .fn()
        .mockResolvedValue({ kind: 'github', baseUrl: 'https://gh.test', scope: { owner: 'acme' } }),
    } as never,
    {} as never,
    { classifyByPair: vi.fn().mockResolvedValue(new Map()) } as never,
    {
      addressBook: vi
        .fn()
        .mockResolvedValue(versions.addresses ?? { rules: [], declared: [] }),
    } as never,
    {} as never,
    { get: vi.fn().mockResolvedValue({ doraWindowDays: 30 }) } as never,
    {} as never,
    store as never,
  );
  return { service, store };
}

const WINDOW = { limit: 25, offset: 0 };

describe('what the deployments report says about versions', () => {
  it('carries the frozen readings, the current ones, and whether rules exist', async () => {
    // Three different questions, and the page needs all three: what this
    // deployment was confirmed to have put live, what the environment answers
    // now, and whether this source reads versions at all.
    const { service, store } = build({ rules: 2, latest: [{ repo: 'acme/api' }] });

    const report = await service.list('src-1', {}, WINDOW);

    expect(report.versionRules).toBe(2);
    expect(report.currentVersions).toHaveLength(1);
    expect(report.versions).toEqual([]);
    // The frozen rows are read for the page, not for the window: one row per
    // deployment shown rather than per deployment in the period.
    expect(store.frozenFor).toHaveBeenCalledWith('src-1', ['dep-1']);
  });

  it('reports the rules of a source that has read nothing yet', async () => {
    // The regression this exists for: the page hid its column when there were
    // no readings, which is exactly when somebody looks for it to find out why
    // it is empty.
    const { service } = build({ rules: 1 });

    const report = await service.list('src-1', {}, WINDOW);

    expect(report.versionRules).toBe(1);
    expect(report.versions).toEqual([]);
    expect(report.currentVersions).toEqual([]);
  });

  it('says a source reads no versions at all', async () => {
    const { service } = build({ rules: 0 });

    const report = await service.list('src-1', {}, WINDOW);

    expect(report.versionRules).toBe(0);
  });
});

describe('where the listed deployments say their environment answers', () => {
  it('addresses an environment the platform published nothing for', async () => {
    const { service } = build({
      deployments: [deployment({ environment: 'acme-prod' })],
      addresses: {
        rules: [
          {
            name: 'clients',
            pattern: '^(?<client>\\w+)-prod$',
            urlTemplate: 'https://{client}.example.test',
            mode: 'fill',
            priority: 100,
          },
        ],
        declared: [],
      },
    });

    const report = await service.list('src-1', {}, WINDOW);

    expect(report.deployments.items[0].environmentUrl).toBe('https://acme.example.test');
  });

  it('leaves a published address alone unless a rule says to replace it', async () => {
    const rules = [
      {
        name: 'clients',
        pattern: '.*',
        urlTemplate: 'https://derived.example.test',
        mode: 'fill',
        priority: 100,
      },
    ];
    const listed = [deployment({ environmentUrl: 'https://published.test' })];

    const filling = build({ deployments: listed, addresses: { rules, declared: [] } });
    const overwriting = build({
      deployments: listed,
      addresses: { rules: [{ ...rules[0], mode: 'overwrite' }], declared: [] },
    });

    expect((await filling.service.list('src-1', {}, WINDOW)).deployments.items[0].environmentUrl)
      .toBe('https://published.test');
    expect(
      (await overwriting.service.list('src-1', {}, WINDOW)).deployments.items[0].environmentUrl,
    ).toBe('https://derived.example.test');
  });
});
