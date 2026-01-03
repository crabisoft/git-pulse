import { Injectable } from '@nestjs/common';
import type {
  ChangelogFilters,
  DeploymentBase,
  DeploymentChangelog,
  DeploymentChangelogSummary,
  PipelineStatus,
  Page,
  ReleaseNoteEntry,
  ReleaseNotesGenerator,
} from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toPage, type PageWindow } from '../common/pagination';

/** A changelog on its way in — everything but the identity the row gets here. */
export type NewChangelog = Omit<DeploymentChangelog, 'id' | 'archivedAt' | 'commits'>;

/**
 * Every column but the two heavy ones.
 *
 * A page of releases is a table of dates and refs; carrying every commit
 * message of each to draw it would be most of the payload and none of what it
 * shows. Which is why the counts are columns of their own — see the model.
 */
const SUMMARY = {
  id: true,
  deploymentId: true,
  repo: true,
  environment: true,
  ref: true,
  baseRef: true,
  base: true,
  refUrl: true,
  baseRefUrl: true,
  deploymentUrl: true,
  environmentUrl: true,
  status: true,
  authors: true,
  commits: true,
  unreadable: true,
  generator: true,
  deployedAt: true,
  archivedAt: true,
} as const;

/** The bounds the history page may narrow to. Both sides optional, and usually absent. */
export interface ChangelogWindow {
  from?: Date;
  to?: Date;
}

/**
 * The archive of what deployments carried.
 *
 * Kept apart from the service that fills it so the deployments module can read
 * it without depending on the archiver — which depends on the deployments
 * module in turn. Nothing here decides anything: it reads and writes rows.
 */
@Injectable()
export class ChangelogStore {
  constructor(private readonly prisma: PrismaService) {}

  /** What was filed for one deployment, or null if it never was. */
  async find(sourceId: string, deploymentId: string): Promise<DeploymentChangelog | null> {
    const row = await this.prisma.deploymentChangelog.findUnique({
      where: { sourceId_deploymentId: { sourceId, deploymentId } },
    });
    return row ? toPublic(row) : null;
  }

  /**
   * Which of these deployments are already filed.
   *
   * Asked in one query for the whole batch: an archiving run considers every
   * deployment of the window on every cycle, and all but a handful of them have
   * been filed for weeks.
   */
  async known(sourceId: string, deploymentIds: string[]): Promise<Set<string>> {
    if (deploymentIds.length === 0) return new Set();
    const rows = await this.prisma.deploymentChangelog.findMany({
      where: { sourceId, deploymentId: { in: deploymentIds } },
      select: { deploymentId: true },
    });
    return new Set(rows.map((row) => row.deploymentId));
  }

  /**
   * Files one, and leaves an existing record exactly as it was.
   *
   * Written once on purpose: the whole value of this table is that it says what
   * was true then. A second run finding the branch deleted would otherwise
   * overwrite a full changelog with an empty one.
   */
  async record(sourceId: string, log: NewChangelog): Promise<void> {
    await this.prisma.deploymentChangelog.upsert({
      where: { sourceId_deploymentId: { sourceId, deploymentId: log.deploymentId } },
      create: { sourceId, ...toRow(log) },
      update: {},
    });
  }

  /** The archive, newest first, narrowed and windowed by the database. */
  async list(
    sourceId: string,
    filters: ChangelogFilters,
    bounds: ChangelogWindow,
    window: PageWindow,
  ): Promise<Page<DeploymentChangelogSummary>> {
    const where = {
      sourceId,
      ...(filters.repos?.length ? { repo: { in: filters.repos } } : {}),
      ...(filters.environments?.length ? { environment: { in: filters.environments } } : {}),
      ...(bounds.from || bounds.to
        ? {
            deployedAt: {
              ...(bounds.from ? { gte: bounds.from } : {}),
              ...(bounds.to ? { lte: bounds.to } : {}),
            },
          }
        : {}),
      // Over the rendered text as well as the ref: what a reader remembers of a
      // release is a word from a commit summary, not the sha it landed under.
      ...(filters.search
        ? {
            OR: [
              { markdown: { contains: filters.search, mode: 'insensitive' as const } },
              { ref: { contains: filters.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.deploymentChangelog.findMany({
        where,
        select: SUMMARY,
        orderBy: { deployedAt: 'desc' },
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.deploymentChangelog.count({ where }),
    ]);
    return toPage(rows.map(toSummary), total, window);
  }

  /**
   * What the filter controls offer, over the whole archive rather than the
   * page: a repo that stopped deploying last spring is exactly what somebody
   * reading months back is looking for.
   */
  async vocabularies(sourceId: string): Promise<{ repos: string[]; environments: string[] }> {
    const rows = await this.prisma.deploymentChangelog.findMany({
      where: { sourceId },
      select: { repo: true, environment: true },
      distinct: ['repo', 'environment'],
    });
    return {
      repos: [...new Set(rows.map((row) => row.repo))].sort(),
      environments: [...new Set(rows.map((row) => row.environment))].sort(),
    };
  }

  /** When the archiver last wrote for this source. Null before its first run. */
  async lastArchivedAt(sourceId: string): Promise<Date | null> {
    const row = await this.prisma.deploymentChangelog.findFirst({
      where: { sourceId },
      orderBy: { archivedAt: 'desc' },
      select: { archivedAt: true },
    });
    return row?.archivedAt ?? null;
  }
}

/** The row as Prisma takes it — the dates typed, the entries as JSON. */
function toRow(log: NewChangelog) {
  return {
    deploymentId: log.deploymentId,
    repo: log.repo,
    environment: log.environment,
    ref: log.ref,
    baseRef: log.baseRef,
    base: log.base,
    refUrl: log.refUrl,
    baseRefUrl: log.baseRefUrl,
    deploymentUrl: log.deploymentUrl,
    environmentUrl: log.environmentUrl,
    status: log.status,
    entries: log.entries as unknown as object[],
    markdown: log.markdown,
    authors: log.authors,
    // Counted on the way in rather than read back off the JSON: it is what the
    // history page lists, and the only reason it is a column at all.
    commits: log.entries.length,
    unreadable: log.unreadable,
    generator: log.generator,
    deployedAt: new Date(log.deployedAt),
  };
}

/** The columns of `SUMMARY`, as Prisma hands them back. */
type SummaryRow = {
  id: string;
  deploymentId: string;
  repo: string;
  environment: string;
  ref: string;
  baseRef: string | null;
  base: string;
  refUrl: string;
  baseRefUrl: string | null;
  deploymentUrl: string | null;
  environmentUrl: string | null;
  status: string;
  authors: number;
  commits: number;
  unreadable: boolean;
  generator: string;
  deployedAt: Date;
  archivedAt: Date;
};

/** A stored row as the API states it — dates as ISO, enums cast back. */
function toSummary(row: SummaryRow): DeploymentChangelogSummary {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    repo: row.repo,
    environment: row.environment,
    ref: row.ref,
    baseRef: row.baseRef,
    base: row.base as DeploymentBase,
    refUrl: row.refUrl,
    baseRefUrl: row.baseRefUrl,
    deploymentUrl: row.deploymentUrl,
    environmentUrl: row.environmentUrl,
    status: row.status as PipelineStatus,
    authors: row.authors,
    commits: row.commits,
    unreadable: row.unreadable,
    generator: row.generator as ReleaseNotesGenerator,
    deployedAt: row.deployedAt.toISOString(),
    archivedAt: row.archivedAt.toISOString(),
  };
}

/** The whole record, contents included. What one reader of one release gets. */
function toPublic(row: SummaryRow & { entries: unknown; markdown: string }): DeploymentChangelog {
  return {
    ...toSummary(row),
    // Written by this service and never by hand, so the cast restates the shape
    // the column was filled with rather than trusting an unknown payload.
    entries: (row.entries ?? []) as ReleaseNoteEntry[],
    markdown: row.markdown,
  };
}
