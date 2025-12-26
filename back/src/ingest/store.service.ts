import { Injectable } from '@nestjs/common';
import type {
  Deployment,
  MergedPullRequest,
  Pipeline,
  PipelineStatus,
  PullRequest,
  PullRequestState,
} from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ageHours } from '../sources/connectors/scope.util';
import {
  mergeDeployment,
  mergeMergedPullRequest,
  mergeOpenPullRequest,
  mergePipeline,
  type DeploymentRow,
  type PipelineRow,
  type PullRequestRow,
} from './merge';

/** States a pull request is still on the board in. */
const ON_BOARD: PullRequestState[] = ['open', 'draft'];

/**
 * How many runs and deployments a repository contributes to a read.
 *
 * The same numbers the connectors page with, deliberately: the dashboard
 * summary counts failed and running pipelines over what it was handed, so a
 * source that stores its data must not answer over a wider set than the same
 * source read live would. The merged pull requests are the exception — see
 * `readMergedPullRequests`.
 */
const PIPELINES_PER_REPO = 20;
const DEPLOYMENTS_PER_REPO = 30;

/**
 * The read model behind `stored` mode: what the ingestion writes, and what the
 * dashboard and DORA read instead of calling a provider.
 *
 * Every write goes through the merge rules next door and is guarded again at
 * the database: a synchronisation and a webhook can touch the same row at the
 * same moment, and the one carrying the older state has to lose.
 */
@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Writes ────────────────────────────────────────────────────────

  /** Records the repositories in scope. Absent ones are left to the pruning. */
  async upsertRepos(
    sourceId: string,
    repos: Array<{ name: string; defaultBranch?: string | null }>,
    seenAt: Date,
  ): Promise<number> {
    for (const repo of repos) {
      await this.prisma.storedRepo.upsert({
        where: { sourceId_name: { sourceId, name: repo.name } },
        create: { sourceId, name: repo.name, defaultBranch: repo.defaultBranch ?? null, seenAt },
        // A default branch is not always read: keep the known one rather than
        // blanking it on a listing that did not ask for it.
        update: { seenAt, ...(repo.defaultBranch ? { defaultBranch: repo.defaultBranch } : {}) },
      });
    }
    return repos.length;
  }

  async upsertPullRequests(sourceId: string, prs: PullRequest[], seenAt: Date): Promise<number> {
    if (prs.length === 0) return 0;
    const held = await this.loadPullRequests(sourceId, prs.map((pr) => pr.id));
    const stale: string[] = [];
    let written = 0;
    for (const pr of prs) {
      const row = mergeOpenPullRequest(held.get(pr.id), pr, seenAt);
      if (row) written += await this.writePullRequest(sourceId, pr.id, row);
      else stale.push(pr.id);
    }
    // A reading with nothing to add still says the pull request was listed, and
    // `seenAt` is what the reconciliation reads to decide one is gone. Without
    // this, a row a webhook had already carried further would be closed by the
    // very run that saw it open.
    if (stale.length > 0) {
      await this.prisma.storedPullRequest.updateMany({
        where: { sourceId, externalId: { in: stale } },
        data: { seenAt },
      });
    }
    return written;
  }

  async upsertMergedPullRequests(
    sourceId: string,
    prs: MergedPullRequest[],
    seenAt: Date,
  ): Promise<number> {
    if (prs.length === 0) return 0;
    const held = await this.loadPullRequests(sourceId, prs.map((pr) => pr.id));
    let written = 0;
    for (const pr of prs) {
      const row = mergeMergedPullRequest(held.get(pr.id), pr, seenAt);
      written += await this.writePullRequest(sourceId, pr.id, row);
    }
    return written;
  }

  async upsertPipelines(sourceId: string, items: Pipeline[], seenAt: Date): Promise<number> {
    if (items.length === 0) return 0;
    const held = await this.loadPipelines(sourceId, items.map((p) => p.id));
    let written = 0;
    for (const item of items) {
      const row = mergePipeline(held.get(item.id), item, seenAt);
      if (row) written += await this.writePipeline(sourceId, row);
    }
    return written;
  }

  async upsertDeployments(sourceId: string, items: Deployment[], seenAt: Date): Promise<number> {
    if (items.length === 0) return 0;
    const held = await this.loadDeployments(sourceId, items.map((d) => d.id));
    let written = 0;
    for (const item of items) {
      written += await this.writeDeployment(sourceId, mergeDeployment(held.get(item.id), item, seenAt));
    }
    return written;
  }

  // ─── Reads ─────────────────────────────────────────────────────────

  async readRepos(sourceId: string): Promise<string[]> {
    const rows = await this.prisma.storedRepo.findMany({
      where: { sourceId },
      orderBy: { name: 'asc' },
      select: { name: true },
    });
    return rows.map((r) => r.name);
  }

  async readPullRequests(sourceId: string, repos: string[]): Promise<PullRequest[]> {
    if (repos.length === 0) return [];
    const rows = await this.prisma.storedPullRequest.findMany({
      where: { sourceId, repo: { in: repos }, state: { in: ON_BOARD } },
      orderBy: { openedAt: 'asc' },
    });
    return rows.map(toPullRequest);
  }

  /**
   * One query per repository rather than one capped over all of them: a single
   * busy repository would otherwise fill the window and hide every other one.
   * Prisma sends them as a single batch, so this stays one round trip.
   */
  async readPipelines(sourceId: string, repos: string[]): Promise<Pipeline[]> {
    if (repos.length === 0) return [];
    const perRepo = await this.prisma.$transaction(
      repos.map((repo) =>
        this.prisma.storedPipeline.findMany({
          where: { sourceId, repo },
          orderBy: { createdAt: 'desc' },
          take: PIPELINES_PER_REPO,
        }),
      ),
    );
    return perRepo.flat().map(toPipeline);
  }

  async readDeployments(sourceId: string, repos: string[]): Promise<Deployment[]> {
    if (repos.length === 0) return [];
    const perRepo = await this.prisma.$transaction(
      repos.map((repo) =>
        this.prisma.storedDeployment.findMany({
          where: { sourceId, repo },
          orderBy: { createdAt: 'desc' },
          take: DEPLOYMENTS_PER_REPO,
        }),
      ),
    );
    return perRepo.flat().map(toDeployment);
  }

  /**
   * Every merge in the window, uncapped — unlike the listings above.
   *
   * Read live, this is the connectors' heaviest fan-out, and they page it short
   * to survive a rate limit. Stored, the rows are already there: capping them
   * would throw away lead times for no benefit, and DORA windows its own period
   * anyway.
   */
  async readMergedPullRequests(
    sourceId: string,
    repos: string[],
    since: string,
  ): Promise<MergedPullRequest[]> {
    if (repos.length === 0) return [];
    const rows = await this.prisma.storedPullRequest.findMany({
      where: { sourceId, repo: { in: repos }, mergedAt: { gte: new Date(since) } },
      orderBy: { mergedAt: 'desc' },
    });
    return rows.map(toMergedPullRequest);
  }

  /**
   * How old the freshest complete picture is — the **oldest** of the per
   * resource timestamps, since the view is only as current as its stalest part.
   * Null when nothing has ever synced, which is not the same as being current.
   */
  async freshness(sourceId: string): Promise<Date | null> {
    const rows = await this.prisma.syncState.findMany({
      where: { sourceId },
      select: { lastSyncAt: true },
    });
    if (rows.length === 0) return null;
    let oldest: Date | null = null;
    for (const row of rows) {
      if (!row.lastSyncAt) return null;
      if (!oldest || row.lastSyncAt.getTime() < oldest.getTime()) oldest = row.lastSyncAt;
    }
    return oldest;
  }

  // ─── Reconciliation ────────────────────────────────────────────────

  /**
   * Closes the pull requests a full listing no longer reported. Without it a
   * missed webhook leaves one open on the board for good — the failure mode
   * that makes a stored view drift away from its provider.
   *
   * Closed rather than merged: not being listed as open says the state moved,
   * not where to. A real merge comes back through the merged feed with its date.
   */
  async closeStalePullRequests(sourceId: string, before: Date, at: Date): Promise<number> {
    const { count } = await this.prisma.storedPullRequest.updateMany({
      where: { sourceId, state: { in: ON_BOARD }, seenAt: { lt: before } },
      data: { state: 'closed', seenAt: at },
    });
    return count;
  }

  /**
   * Drops what belongs to repositories the scope no longer covers.
   *
   * An empty list is ignored on purpose: a listing that failed and a source
   * whose scope matches nothing look the same from here, and only one of them
   * is a reason to erase everything stored.
   */
  async pruneOutOfScope(sourceId: string, repos: string[]): Promise<number> {
    if (repos.length === 0) return 0;
    const where = { sourceId, repo: { notIn: repos } };
    const [prs, pipelines, deployments, stale] = await this.prisma.$transaction([
      this.prisma.storedPullRequest.deleteMany({ where }),
      this.prisma.storedPipeline.deleteMany({ where }),
      this.prisma.storedDeployment.deleteMany({ where }),
      this.prisma.storedRepo.deleteMany({ where: { sourceId, name: { notIn: repos } } }),
    ]);
    return prs.count + pipelines.count + deployments.count + stale.count;
  }

  // ─── Guarded writes ────────────────────────────────────────────────

  /**
   * Writes a row without ever going backwards.
   *
   * The update carries the staleness guard in its `where`, so a concurrent
   * writer holding a newer state simply matches nothing. A miss then means one
   * of two things — the row is new, or somebody else got there first — and the
   * unique index tells them apart without a transaction.
   */
  private async writePullRequest(
    sourceId: string,
    externalId: string,
    row: PullRequestRow,
  ): Promise<number> {
    const { count } = await this.prisma.storedPullRequest.updateMany({
      where: { sourceId, externalId, updatedAt: { lte: row.updatedAt } },
      data: row,
    });
    if (count > 0) return count;
    return this.createOrLose(() =>
      this.prisma.storedPullRequest.create({ data: { sourceId, externalId, ...row } }),
    );
  }

  private async writePipeline(sourceId: string, row: PipelineRow): Promise<number> {
    const { count } = await this.prisma.storedPipeline.updateMany({
      where: { sourceId, externalId: row.externalId, updatedAt: { lte: row.updatedAt } },
      data: row,
    });
    if (count > 0) return count;
    return this.createOrLose(() => this.prisma.storedPipeline.create({ data: { sourceId, ...row } }));
  }

  /**
   * A deployment states no update date, so there is no timestamp to guard on:
   * the settling order in the merge is the guard, and it needs the stored row —
   * which the caller already loaded.
   */
  private async writeDeployment(sourceId: string, row: DeploymentRow): Promise<number> {
    const { count } = await this.prisma.storedDeployment.updateMany({
      where: { sourceId, externalId: row.externalId },
      data: row,
    });
    if (count > 0) return count;
    return this.createOrLose(() =>
      this.prisma.storedDeployment.create({ data: { sourceId, ...row } }),
    );
  }

  /** Creates, unless a concurrent writer already did — where losing is correct. */
  private async createOrLose(create: () => Promise<unknown>): Promise<number> {
    try {
      await create();
      return 1;
    } catch (e) {
      if (isUniqueViolation(e)) return 0;
      throw e;
    }
  }

  private async loadPullRequests(
    sourceId: string,
    externalIds: string[],
  ): Promise<Map<string, PullRequestRow>> {
    const rows = await this.prisma.storedPullRequest.findMany({
      where: { sourceId, externalId: { in: externalIds } },
    });
    return new Map(rows.map((row) => [row.externalId, toPullRequestRow(row)]));
  }

  private async loadPipelines(
    sourceId: string,
    externalIds: string[],
  ): Promise<Map<string, PipelineRow>> {
    const rows = await this.prisma.storedPipeline.findMany({
      where: { sourceId, externalId: { in: externalIds } },
    });
    return new Map(rows.map((row) => [row.externalId, toPipelineRow(row)]));
  }

  private async loadDeployments(
    sourceId: string,
    externalIds: string[],
  ): Promise<Map<string, DeploymentRow>> {
    const rows = await this.prisma.storedDeployment.findMany({
      where: { sourceId, externalId: { in: externalIds } },
    });
    return new Map(rows.map((row) => [row.externalId, toDeploymentRow(row)]));
  }
}

/** Prisma's code for a unique constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * The rows as Prisma hands them over. Declared here rather than imported from
 * the generated client: the enums travel as plain strings in the database, and
 * narrowing them back is this file's job.
 */
interface PullRequestRecord {
  externalId: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  author: string | null;
  url: string;
  repoUrl: string | null;
  headRef: string;
  openedAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  reviewers: number;
  firstCommitAt: Date | null;
  firstReviewAt: Date | null;
  seenAt: Date;
}

interface PipelineRecord {
  externalId: string;
  repo: string;
  repoUrl: string | null;
  ref: string;
  status: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  durationSec: number | null;
  seenAt: Date;
}

interface DeploymentRecord {
  externalId: string;
  repo: string;
  environment: string;
  ref: string;
  status: string;
  environmentUrl: string | null;
  url: string | null;
  createdAt: Date;
  seenAt: Date;
}

function toPullRequestRow(row: PullRequestRecord): PullRequestRow {
  return {
    repo: row.repo,
    number: row.number,
    title: row.title,
    state: row.state as PullRequestState,
    author: row.author,
    url: row.url,
    repoUrl: row.repoUrl,
    headRef: row.headRef,
    openedAt: row.openedAt,
    updatedAt: row.updatedAt,
    mergedAt: row.mergedAt,
    reviewers: row.reviewers,
    firstCommitAt: row.firstCommitAt,
    firstReviewAt: row.firstReviewAt,
    seenAt: row.seenAt,
  };
}

function toPipelineRow(row: PipelineRecord): PipelineRow {
  return { ...row, status: row.status as PipelineStatus };
}

function toDeploymentRow(row: DeploymentRecord): DeploymentRow {
  return { ...row, status: row.status as PipelineStatus };
}

function toPullRequest(row: PullRequestRecord): PullRequest {
  return {
    id: row.externalId,
    number: row.number,
    title: row.title,
    state: row.state as PullRequestState,
    author: row.author ?? 'unknown',
    repo: row.repo,
    repoUrl: row.repoUrl ?? '',
    url: row.url,
    headRef: row.headRef,
    createdAt: row.openedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    mergedAt: row.mergedAt?.toISOString() ?? null,
    reviewers: row.reviewers,
    ageHours: ageHours(row.openedAt.toISOString()),
    // Filled by the service, which owns the rules — exactly as a connector
    // leaves them, so the rules apply at read time in either mode.
    tickets: [],
  };
}

function toMergedPullRequest(row: PullRequestRecord): MergedPullRequest {
  return {
    id: row.externalId,
    repo: row.repo,
    number: row.number,
    title: row.title,
    url: row.url,
    headRef: row.headRef,
    openedAt: row.openedAt.toISOString(),
    firstCommitAt: row.firstCommitAt?.toISOString() ?? null,
    firstReviewAt: row.firstReviewAt?.toISOString() ?? null,
    // Only rows carrying one are read as merged.
    mergedAt: (row.mergedAt as Date).toISOString(),
  };
}

function toPipeline(row: PipelineRecord): Pipeline {
  return {
    id: row.externalId,
    repo: row.repo,
    repoUrl: row.repoUrl ?? '',
    ref: row.ref,
    status: row.status as PipelineStatus,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    durationSec: row.durationSec,
  };
}

function toDeployment(row: DeploymentRecord): Deployment {
  return {
    id: row.externalId,
    repo: row.repo,
    environment: row.environment,
    ref: row.ref,
    status: row.status as PipelineStatus,
    createdAt: row.createdAt.toISOString(),
    environmentUrl: row.environmentUrl,
    url: row.url,
  };
}
