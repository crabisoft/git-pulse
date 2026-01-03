import { describe, expect, it, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import type { ClassifiedDeployment, DeploymentChanges, PipelineStatus } from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import type { SettingsService } from '../settings/settings.service';
import type { ApiQuotaService } from '../api-quota/api-quota.service';
import type { DeploymentsService } from '../deployments/deployments.service';
import type { ChangelogStore } from './changelog.store';
import { ChangelogsService } from './changelogs.service';

function deployment(id: string, day = 1, status: PipelineStatus = 'success'): ClassifiedDeployment {
  return {
    id,
    repo: 'widget',
    environment: 'prod',
    ref: `v-${id}`,
    status,
    createdAt: `2026-07-0${day}T10:00:00Z`,
    environmentUrl: 'https://widget.example',
    url: 'https://github.com/acme/widget/actions/runs/1',
    attributes: {},
    metaEnvironments: ['production'],
    refUrl: `https://github.com/acme/widget/tree/v-${id}`,
  };
}

function changes(overrides: Partial<DeploymentChanges> = {}): DeploymentChanges {
  return {
    deployment: deployment('a'),
    repo: 'widget',
    head: 'v-a',
    base: 'previous',
    baseRef: 'v-old',
    baseRefUrl: 'https://github.com/acme/widget/tree/v-old',
    entries: [],
    authors: 2,
    markdown: '## widget',
    archivedAt: null,
    ...overrides,
  };
}

/** The service with fakes for everything it reaches, and the calls it made. */
function service(options: { deployments: ClassifiedDeployment[]; allows?: boolean[] }) {
  const record = vi.fn().mockResolvedValue(undefined);
  const contentsOf = vi.fn().mockResolvedValue(changes());
  const allows = options.allows ? [...options.allows] : null;
  const allowsOptional = vi.fn(() => (allows ? (allows.shift() ?? true) : true));

  const changelogs = new ChangelogsService(
    { known: vi.fn().mockResolvedValue(new Set()), record } as unknown as ChangelogStore,
    {
      classified: vi.fn().mockResolvedValue(options.deployments),
      contentsOf,
    } as unknown as DeploymentsService,
    {
      get: vi.fn().mockResolvedValue({
        doraWindowDays: 30,
        quotaReservePct: 10,
        releaseNotesGenerator: 'builtin',
      }),
    } as unknown as SettingsService,
    { allowsOptional } as unknown as ApiQuotaService,
  );
  return { changelogs, record, contentsOf };
}

describe('archive', () => {
  it('files what a deployment carried, links and all', async () => {
    const { changelogs, record } = service({ deployments: [deployment('a')] });

    const outcome = await changelogs.archive('src-1');

    expect(outcome).toEqual({ archived: 1, known: 0, deferred: 0, unreadable: 0, failed: 0 });
    expect(record).toHaveBeenCalledWith('src-1', {
      deploymentId: 'a',
      repo: 'widget',
      environment: 'prod',
      ref: 'v-a',
      baseRef: 'v-old',
      base: 'previous',
      refUrl: 'https://github.com/acme/widget/tree/v-a',
      baseRefUrl: 'https://github.com/acme/widget/tree/v-old',
      deploymentUrl: 'https://github.com/acme/widget/actions/runs/1',
      environmentUrl: 'https://widget.example',
      status: 'success',
      entries: [],
      markdown: '## widget',
      authors: 2,
      unreadable: false,
      generator: 'builtin',
      deployedAt: '2026-07-01T10:00:00Z',
    });
  });

  it('stops where the rate-limit reserve is reached, and defers the rest', async () => {
    const { changelogs, record } = service({
      deployments: [deployment('a', 1), deployment('b', 2), deployment('c', 3)],
      allows: [true, false],
    });

    const outcome = await changelogs.archive('src-1');

    expect(outcome.archived).toBe(1);
    expect(outcome.deferred).toBe(2);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('files a deployment whose refs the platform has dropped, rather than retrying it for ever', async () => {
    const { changelogs, contentsOf, record } = service({ deployments: [deployment('a')] });
    contentsOf.mockRejectedValueOnce(
      new CodedException('errors.compare.unresolvable', HttpStatus.NOT_FOUND, {
        repo: 'widget',
        from: 'v-old',
        to: 'v-a',
      }),
    );

    const outcome = await changelogs.archive('src-1');

    expect(outcome).toEqual({ archived: 0, known: 0, deferred: 0, unreadable: 1, failed: 0 });
    expect(record).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({
        deploymentId: 'a',
        unreadable: true,
        // No base and no text: the comparison never happened, and naming what
        // it would have been made against would state a range nobody read.
        baseRef: null,
        entries: [],
        markdown: '',
      }),
    );
  });

  it('keeps filing the batch when one deployment cannot be read', async () => {
    const { changelogs, contentsOf, record } = service({
      deployments: [deployment('a', 1), deployment('b', 2)],
    });
    contentsOf.mockRejectedValueOnce(new Error('404 no such ref'));

    const outcome = await changelogs.archive('src-1');

    expect(outcome).toEqual({ archived: 1, known: 0, deferred: 0, unreadable: 0, failed: 1 });
    expect(record).toHaveBeenCalledTimes(1);
  });
});
