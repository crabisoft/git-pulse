import { Injectable } from '@nestjs/common';
import type { CoverageSpan, SourceCoverage, SourceMode } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { depthDays } from './sync-cadence';

const DAY_MS = 86_400_000;

/** A table that holds nothing for a source — not the same as an absent source. */
const EMPTY: CoverageSpan = { from: null, to: null, days: null, count: 0 };

/**
 * How much history each source actually has behind it.
 *
 * The depth a source is configured with says what the ingestion asks its
 * provider for; it says nothing about what came back. An install collecting
 * since Monday has four days whatever the field reads, and every report over a
 * longer period is quietly answering from rows that do not exist — the reader
 * sees a number, not a gap.
 *
 * Aggregated per table rather than per source: one `groupBy` answers for every
 * source at once, so a page listing ten of them costs five queries and not
 * fifty. All of them are index-backed — `(sourceId, createdAt)` on the stored
 * tables, `(sourceId, metric, capturedAt)` on the snapshots.
 */
@Injectable()
export class CoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(now: Date = new Date()): Promise<SourceCoverage[]> {
    const { doraWindowDays, retentionMarginDays } = await this.settings.get();
    const [sources, deployments, pullRequests, pipelines, metrics] = await Promise.all([
      this.prisma.source.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, mode: true, historyDays: true },
      }),
      this.prisma.storedDeployment.groupBy({
        by: ['sourceId'],
        _min: { createdAt: true },
        _max: { createdAt: true },
        _count: { _all: true },
      }),
      // Opened at, not updated at: what is asked is how far back the history
      // reaches, and a pull request from last spring touched this morning is
      // still history from last spring.
      this.prisma.storedPullRequest.groupBy({
        by: ['sourceId'],
        _min: { openedAt: true },
        _max: { openedAt: true },
        _count: { _all: true },
      }),
      this.prisma.storedPipeline.groupBy({
        by: ['sourceId'],
        _min: { createdAt: true },
        _max: { createdAt: true },
        _count: { _all: true },
      }),
      this.prisma.metricSnapshot.groupBy({
        by: ['sourceId'],
        _min: { capturedAt: true },
        _max: { capturedAt: true },
        _count: { _all: true },
      }),
    ]);

    const deployed = spans(deployments, (r) => r._min.createdAt, (r) => r._max.createdAt, now);
    const opened = spans(pullRequests, (r) => r._min.openedAt, (r) => r._max.openedAt, now);
    const ran = spans(pipelines, (r) => r._min.createdAt, (r) => r._max.createdAt, now);
    const captured = spans(metrics, (r) => r._min.capturedAt, (r) => r._max.capturedAt, now);

    return sources.map((source) => {
      // A live source is read from its provider at every request and stores
      // nothing: a depth would be a promise about a store it does not keep.
      const depth = source.mode === 'stored' ? depthDays(source.historyDays, doraWindowDays) : null;
      return {
        sourceId: source.id,
        mode: source.mode as SourceMode,
        depthDays: depth,
        retainedDays: depth === null ? null : depth + retentionMarginDays,
        deployments: deployed.get(source.id) ?? EMPTY,
        pullRequests: opened.get(source.id) ?? EMPTY,
        pipelines: ran.get(source.id) ?? EMPTY,
        metrics: captured.get(source.id) ?? EMPTY,
      };
    });
  }
}

/** One `groupBy` result, folded into the span it describes, keyed by source. */
function spans<T extends { sourceId: string; _count: { _all: number } }>(
  rows: T[],
  min: (row: T) => Date | null,
  max: (row: T) => Date | null,
  now: Date,
): Map<string, CoverageSpan> {
  return new Map(
    rows.map((row) => {
      const from = min(row);
      const to = max(row);
      return [
        row.sourceId,
        {
          from: from?.toISOString() ?? null,
          to: to?.toISOString() ?? null,
          days: from ? daysSince(from, now) : null,
          count: row._count._all,
        },
      ];
    }),
  );
}

/**
 * Whole days back — rounded down, so the figure is a floor and never a promise
 * of history that is not there. Floored at one all the same: a table filled an
 * hour ago covers a day and not none, and "0 day" beside a row count that is
 * not zero reads as a bug.
 */
function daysSince(from: Date, now: Date): number {
  return Math.max(1, Math.floor((now.getTime() - from.getTime()) / DAY_MS));
}
