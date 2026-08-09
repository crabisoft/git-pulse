import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { RuleTarget } from '@repo/shared';
import { subjectKey, type ClassifySubject } from '../env-rules/env-rules.service';
import type { SourceMergedPullRequest } from '../sources/connectors/source-connector.interface';
import { DoraService } from './dora.service';

const SOURCE_ID = 'src-1';
const NOW = '2026-08-01T12:00:00.000Z';

function mergedPr(over: Partial<SourceMergedPullRequest> = {}): SourceMergedPullRequest {
  return {
    id: 'gh:monorepo:42',
    repo: 'monorepo',
    number: 42,
    title: 'feat(front): ajoute le sélecteur',
    body: '',
    url: 'https://github.com/acme/monorepo/pull/42',
    headRef: 'feat/picker',
    openedAt: '2026-07-20T08:00:00.000Z',
    firstCommitAt: '2026-07-19T17:00:00.000Z',
    firstReviewAt: '2026-07-22T09:00:00.000Z',
    mergedAt: '2026-07-26T10:00:00.000Z',
    labels: [],
    ...over,
  };
}

/** What one target answers, keyed by the subject name it was asked about. */
type Answers = Record<string, Record<string, string>>;

/**
 * The service with a classifier that answers per target, and nothing else: what
 * is under test is which of the three targets keeps a key the others also
 * state, which no amount of real rules would show more clearly.
 */
function service(prs: SourceMergedPullRequest[], answers: Partial<Record<RuleTarget, Answers>>) {
  const classifyByPair = vi
    .fn()
    .mockImplementation((_id: string, subjects: ClassifySubject[], target: RuleTarget) => {
      const forTarget = answers[target] ?? {};
      return Promise.resolve(
        new Map(
          subjects.map((subject) => [
            subjectKey(subject),
            {
              name: subject.name,
              attributes: forTarget[subject.name] ?? {},
              metaEnvironments: [],
            },
          ]),
        ),
      );
    });
  const reader = {
    mode: 'stored',
    scope: { owner: 'acme' },
    listRepositories: vi.fn().mockResolvedValue(['monorepo']),
    listDeployments: vi.fn().mockResolvedValue([]),
    listMergedPullRequests: vi.fn().mockResolvedValue(prs),
  };
  const dora = new DoraService(
    {} as never,
    {} as never,
    { for: vi.fn().mockResolvedValue(reader) } as never,
    {} as never,
    { incidentTrackerFor: vi.fn().mockResolvedValue(null) } as never,
    { classifyByPair } as never,
    {
      extractMany: vi.fn().mockImplementation((_id, texts: unknown[]) => texts.map(() => [])),
    } as never,
    {
      get: vi.fn().mockResolvedValue({
        doraWindowDays: 30,
        failureSource: 'pipelines',
        incidentLabels: [],
        componentAttribute: null,
      }),
    } as never,
  );
  return { dora, classifyByPair };
}

beforeEach(() => {
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the dimensions a merged pull request carries', () => {
  it('reads nothing where no rule matches, as it always did', async () => {
    const { dora } = service([mergedPr()], {});

    const report = await dora.report(SOURCE_ID, {});

    expect(report.dimensions).toEqual({});
  });

  it('classifies the repo name, which is the historical behaviour', async () => {
    const { dora } = service([mergedPr()], {
      repository: { monorepo: { app: 'Portal' } },
    });

    const report = await dora.report(SOURCE_ID, {});

    expect(report.dimensions).toEqual({ app: ['Portal'] });
  });

  it('reads the component out of a title following the commit convention', async () => {
    const { dora } = service([mergedPr()], {
      pull_request_title: { 'feat(front): ajoute le sélecteur': { component: 'front' } },
    });

    const report = await dora.report(SOURCE_ID, {});

    expect(report.dimensions).toEqual({ component: ['front'] });
  });

  it('accumulates the attributes of every label it carries', async () => {
    const { dora } = service([mergedPr({ labels: ['area/front', 'kind/bug'] })], {
      pull_request: {
        'area/front': { component: 'front' },
        'kind/bug': { change: 'bug' },
      },
    });

    const report = await dora.report(SOURCE_ID, {});

    expect(report.dimensions).toEqual({ change: ['bug'], component: ['front'] });
  });

  it('lets a label beat the title, and the title beat the repo', async () => {
    const { dora } = service([mergedPr({ labels: ['area/front'] })], {
      pull_request: { 'area/front': { component: 'front' } },
      pull_request_title: { 'feat(front): ajoute le sélecteur': { component: 'titre' } },
      repository: { monorepo: { component: 'repo' } },
    });

    const report = await dora.report(SOURCE_ID, {});

    expect(report.dimensions).toEqual({ component: ['front'] });
  });

  it('keeps the repo answer for a key nothing nearer states', async () => {
    const { dora } = service([mergedPr({ labels: ['area/front'] })], {
      pull_request: { 'area/front': { component: 'front' } },
      repository: { monorepo: { client: 'Contoso' } },
    });

    const report = await dora.report(SOURCE_ID, {});

    expect(report.dimensions).toEqual({ client: ['Contoso'], component: ['front'] });
  });

  it('settles two disagreeing labels on the sorted order, not the platform’s', async () => {
    const answers = {
      pull_request: {
        'area/back': { component: 'back' },
        'area/front': { component: 'front' },
      },
    };
    const oneWay = service([mergedPr({ labels: ['area/front', 'area/back'] })], answers);
    const other = service([mergedPr({ labels: ['area/back', 'area/front'] })], answers);

    const first = await oneWay.dora.report(SOURCE_ID, {});
    const second = await other.dora.report(SOURCE_ID, {});

    expect(first.dimensions).toEqual({ component: ['back'] });
    expect(second.dimensions).toEqual(first.dimensions);
  });

  it('states the repo of every subject, so a rule confined to one contributes', async () => {
    const { dora, classifyByPair } = service([mergedPr({ labels: ['area/front'] })], {});

    await dora.report(SOURCE_ID, {});

    const calls = classifyByPair.mock.calls as Array<[string, ClassifySubject[], RuleTarget]>;
    const asked = new Map<RuleTarget, ClassifySubject[]>(
      calls.map(([, subjects, target]) => [target, subjects]),
    );
    expect(asked.get('pull_request')).toEqual([{ name: 'area/front', repo: 'monorepo' }]);
    expect(asked.get('pull_request_title')).toEqual([
      { name: 'feat(front): ajoute le sélecteur', repo: 'monorepo' },
    ]);
  });
});
