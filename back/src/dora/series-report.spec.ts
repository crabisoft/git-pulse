import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoraService } from './dora.service';

/**
 * The trend the overview draws, computed from the period being reported on.
 *
 * What is checked here is the property the historised snapshots could not give:
 * the line follows the period. A snapshot holds what a metric was worth over
 * the collection's own window on the day it was taken, so every period was
 * shown the same twelve points — the figures moved and the line did not.
 */

const SOURCE_ID = 'src-1';
const NOW = '2026-08-01T12:00:00.000Z';

function deployment(at: string) {
  return {
    id: `d-${at}`,
    repo: 'api',
    environment: 'Prod',
    ref: 'v1',
    status: 'success' as const,
    createdAt: at,
    environmentUrl: null,
    url: null,
  };
}

function service(deployments: ReturnType<typeof deployment>[]) {
  const reader = {
    mode: 'stored',
    scope: { owner: 'acme' },
    listRepositories: vi.fn().mockResolvedValue(['api']),
    listDeployments: vi.fn().mockResolvedValue(deployments),
    listMergedPullRequests: vi.fn().mockResolvedValue([]),
  };

  const dora = new DoraService(
    {} as never,
    {} as never,
    { for: vi.fn().mockResolvedValue(reader) } as never,
    {} as never,
    { incidentTrackerFor: vi.fn().mockResolvedValue(null) } as never,
    { classifyByPair: vi.fn().mockResolvedValue(new Map()) } as never,
    { extractMany: vi.fn().mockResolvedValue([]) } as never,
    {
      get: vi.fn().mockResolvedValue({
        doraWindowDays: 30,
        failureSource: 'pipelines',
        incidentLabels: [],
      }),
    } as never,
  );
  return { dora, reader };
}

/**
 * Deployment rate per slice — the one metric every fixture here produces.
 *
 * Rounded, and every slice here is a day, so these read as deployments: a
 * slice ends a millisecond before the next one starts, which leaves the rate
 * a hair above the count it was measured from.
 */
function frequency(trend: Array<Array<{ metric: string; value: number }>>): number[] {
  return trend.map((slice) =>
    Number((slice.find((r) => r.metric === 'deployment_frequency')?.value ?? 0).toFixed(6)),
  );
}

beforeEach(() => {
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DoraService.reportOverTime', () => {
  it('cuts the period into slices and computes each one', async () => {
    const { dora } = service([
      deployment('2026-07-27T10:00:00.000Z'),
      deployment('2026-07-30T10:00:00.000Z'),
      deployment('2026-07-31T10:00:00.000Z'),
      deployment('2026-08-01T10:00:00.000Z'),
    ]);

    const report = await dora.reportOverTime(SOURCE_ID, { windowDays: 4 }, 4);

    // Four days, four slices of a day each, oldest first: one deployment on
    // the 27th falls before the window opens at noon on the 28th.
    expect(frequency(report.trend)).toEqual([0, 1, 1, 1]);
  });

  it('follows the period rather than a fixed window', async () => {
    // The complaint this answers: the figures moved with the period and the
    // line beside them never did.
    const deployments = [
      deployment('2026-07-05T10:00:00.000Z'),
      deployment('2026-07-28T10:00:00.000Z'),
      deployment('2026-08-01T10:00:00.000Z'),
    ];

    const short = await service(deployments).dora.reportOverTime(SOURCE_ID, { windowDays: 7 }, 12);
    const long = await service(deployments).dora.reportOverTime(SOURCE_ID, { windowDays: 30 }, 12);

    expect(frequency(short.trend)).not.toEqual(frequency(long.trend));
    // A week draws a point a day; a month is capped at twelve.
    expect(short.trend).toHaveLength(7);
    expect(long.trend).toHaveLength(12);
  });

  it('reads the platform once, however many points it draws', async () => {
    // The whole reason a trend is affordable here: classifying an event does
    // not depend on the period, so twelve points cost one gathering.
    const { dora, reader } = service([deployment('2026-07-30T10:00:00.000Z')]);

    await dora.reportOverTime(SOURCE_ID, { windowDays: 30 }, 12);

    expect(reader.listDeployments).toHaveBeenCalledTimes(1);
    expect(reader.listMergedPullRequests).toHaveBeenCalledTimes(1);
  });

  it('counts every deployment of the period exactly once across the slices', async () => {
    // The slices are disjoint and cover the whole period: one landing on a
    // seam must not be counted twice, and one in a gap not at all.
    const { dora } = service([
      deployment('2026-07-26T00:00:00.000Z'),
      deployment('2026-07-28T06:00:00.000Z'),
      deployment('2026-07-30T18:00:00.000Z'),
      deployment('2026-08-01T11:59:59.000Z'),
    ]);

    const report = await dora.reportOverTime(SOURCE_ID, { windowDays: 8 }, 8);

    const total = report.results.find((r) => r.metric === 'deployment_frequency')?.value ?? 0;
    // Rates, so each side is brought back to deployments: eight slices of a
    // day summed, against the period's own rate over its eight days. A landing
    // on a seam would make one side nine.
    expect(frequency(report.trend).reduce((a, b) => a + b, 0)).toBeCloseTo(total * 8, 5);
  });

  it('answers the same readings as the plain report', async () => {
    // Two ways into the same computation; a trend must not change the number
    // it illustrates.
    const deployments = [deployment('2026-07-30T10:00:00.000Z')];
    const plain = await service(deployments).dora.report(SOURCE_ID, { windowDays: 30 });
    const timed = await service(deployments).dora.reportOverTime(SOURCE_ID, { windowDays: 30 }, 12);

    expect(timed.results).toEqual(plain.results);
    expect(timed.period).toEqual(plain.period);
  });

  it('draws no line at all when none is asked for', async () => {
    const { dora } = service([deployment('2026-07-30T10:00:00.000Z')]);

    const report = await dora.reportOverTime(SOURCE_ID, { windowDays: 30 }, 0);

    expect(report.trend).toEqual([]);
  });
});
