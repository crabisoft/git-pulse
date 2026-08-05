import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceMergedPullRequest } from '../sources/connectors/source-connector.interface';
import { DoraService } from './dora.service';

const SOURCE_ID = 'src-1';
const NOW = '2026-08-01T12:00:00.000Z';

function mergedPr(over: Partial<SourceMergedPullRequest> = {}): SourceMergedPullRequest {
  return {
    id: 'gh:api:42',
    repo: 'api',
    number: 42,
    title: 'Ajoute la pagination',
    body: 'Closes OPS-42',
    url: 'https://github.com/acme/api/pull/42',
    headRef: 'feat/pagination',
    openedAt: '2026-07-20T08:00:00.000Z',
    firstCommitAt: '2026-07-19T17:00:00.000Z',
    firstReviewAt: '2026-07-22T09:00:00.000Z',
    mergedAt: '2026-07-26T10:00:00.000Z',
    labels: [],
    ...over,
  };
}

/**
 * The service with only what a lead-time sample reaches. The reader answers one
 * merged pull request and nothing else, since what is under test is the single
 * hop from that listing to its ticket references.
 */
function service(prs: SourceMergedPullRequest[]) {
  const extractMany = vi.fn().mockImplementation((_id, texts: unknown[]) => texts.map(() => []));
  const reader = {
    mode: 'stored',
    scope: { owner: 'acme' },
    listRepositories: vi.fn().mockResolvedValue(['api']),
    listDeployments: vi.fn().mockResolvedValue([]),
    listMergedPullRequests: vi.fn().mockResolvedValue(prs),
  };
  const dora = new DoraService(
    {} as never,
    {} as never,
    { for: vi.fn().mockResolvedValue(reader) } as never,
    {} as never,
    { incidentTrackerFor: vi.fn().mockResolvedValue(null) } as never,
    { classifyByPair: vi.fn().mockResolvedValue(new Map()) } as never,
    { extractMany } as never,
    {
      get: vi.fn().mockResolvedValue({
        doraWindowDays: 30,
        failureSource: 'pipelines',
        incidentLabels: [],
      }),
    } as never,
  );
  return { dora, extractMany };
}

beforeEach(() => {
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the merged pull requests a lead time is built from', () => {
  it('runs the rules over the description, as the board does', async () => {
    const { dora, extractMany } = service([mergedPr()]);

    await dora.report(SOURCE_ID, {});

    expect(extractMany.mock.calls[0][1]).toEqual([
      { branch: 'feat/pagination', title: 'Ajoute la pagination', body: 'Closes OPS-42' },
    ]);
  });

  it('reads a request the platform reports without one as having none', async () => {
    const { dora, extractMany } = service([mergedPr({ body: '' })]);

    await dora.report(SOURCE_ID, {});

    expect(extractMany.mock.calls[0][1][0]).toMatchObject({ body: '' });
  });
});
