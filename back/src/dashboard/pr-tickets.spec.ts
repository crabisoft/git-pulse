import { describe, expect, it, vi } from 'vitest';
import type { EnvUrlsService } from '../env-urls/env-urls.service';
import type { ReaderFactory } from '../ingest/reader.factory';
import type { SourcePullRequest } from '../sources/connectors/source-connector.interface';
import type { TicketRulesService } from '../ticket-rules/ticket-rules.service';
import { DashboardService } from './dashboard.service';

function pullRequest(over: Partial<SourcePullRequest> = {}): SourcePullRequest {
  return {
    id: 'gh:api:42',
    number: 42,
    title: 'Ajoute la pagination',
    body: 'Closes OPS-42',
    state: 'open',
    author: 'alice',
    repo: 'api',
    repoUrl: 'https://github.com/acme/api',
    url: 'https://github.com/acme/api/pull/42',
    headRef: 'feat/pagination',
    createdAt: '2026-07-20T08:00:00Z',
    updatedAt: '2026-07-25T08:00:00Z',
    mergedAt: null,
    reviewers: 2,
    ageHours: 168,
    labels: [],
    tickets: [],
    ...over,
  };
}

/**
 * The service with only what collecting a board's pull requests reaches. The
 * reader answers one repo and one pull request; everything else is empty, since
 * what is under test is the single hop from a listing to its ticket references.
 */
function service(prs: SourcePullRequest[]) {
  const extractMany = vi.fn().mockImplementation((_id, texts: unknown[]) => texts.map(() => []));
  const reader = {
    mode: 'stored' as const,
    scope: { owner: 'acme' },
    listRepositories: vi.fn().mockResolvedValue(['api']),
    listPullRequests: vi.fn().mockResolvedValue(prs),
    listPipelines: vi.fn().mockResolvedValue([]),
    listDeployments: vi.fn().mockResolvedValue([]),
    freshness: vi.fn().mockResolvedValue(new Date('2026-07-27T12:00:00Z')),
  };
  const dashboard = new DashboardService(
    { for: vi.fn().mockResolvedValue(reader) } as unknown as ReaderFactory,
    { classifyByPair: vi.fn().mockResolvedValue(new Map()) } as never,
    {
      declaredFor: vi.fn().mockResolvedValue([]),
      addressBook: vi.fn().mockResolvedValue(new Map()),
    } as unknown as EnvUrlsService,
    { extractMany } as unknown as TicketRulesService,
    null as never,
  );
  return { dashboard, extractMany };
}

describe('the pull requests a board collects', () => {
  it('runs the rules over the description, which only the store now carries', async () => {
    const { dashboard, extractMany } = service([pullRequest()]);

    await dashboard.collect('src-1');

    expect(extractMany.mock.calls[0][1]).toEqual([
      { branch: 'feat/pagination', title: 'Ajoute la pagination', body: 'Closes OPS-42' },
    ]);
  });

  it('does not send the description on, the page having no use for it', async () => {
    // It is read, not displayed. Carrying it out would put every open pull
    // request's description on the wire for a table that shows none of them.
    const { dashboard } = service([pullRequest()]);

    const { pullRequests } = await dashboard.collect('src-1');

    expect(pullRequests[0]).not.toHaveProperty('body');
    expect(pullRequests[0].number).toBe(42);
  });
});
