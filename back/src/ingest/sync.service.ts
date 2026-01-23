import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SourcesService } from '../sources/sources.service';
import { ConnectorFactory } from '../sources/connectors/connector.factory';
import { SettingsService } from '../settings/settings.service';
import type { ConnectorContext, SourceConnector } from '../sources/connectors/source-connector.interface';
import { StoreService } from './store.service';
import { depthDays, isDueForFullSync, listingSince, mergedSince, skipsDelta } from './sync-cadence';

/** Every listing, for the runs that mark them all at once. */
const RESOURCES: SyncResource[] = ['repos', 'pulls', 'pipelines', 'deployments'];

/** The listings a cursor is kept for. Mirrors the `SyncResource` enum. */
type SyncResource = 'repos' | 'pulls' | 'pipelines' | 'deployments';

/** What one run of the ingestion did. Logged, and returned to a manual caller. */
export interface SyncOutcome {
  /** Whether this run reconciled — listed the whole window and pruned. */
  full: boolean;
  /** Whether the listings were spared because events are keeping up. */
  skipped: boolean;
  repos: number;
  pullRequests: number;
  pipelines: number;
  deployments: number;
  merged: number;
  /** Pull requests the listing no longer reported as open. */
  closed: number;
  /** Rows dropped for repositories the scope no longer covers. */
  pruned: number;
  /** Listings that failed, by resource. A partial run is still a run. */
  failed: SyncResource[];
}

/** How a run was asked for, when it was not the schedule that asked. */
export interface SyncOptions {
  /**
   * Reconciles whatever the cadence says: the whole depth is re-read, the
   * cursors are ignored and recent events spare nothing.
   *
   * What somebody asks for after deepening a source, or after doubting what it
   * holds — neither of which the clock has any way to know about.
   */
  force?: boolean;
}

/**
 * Fills the store from the provider — the only thing that spends a stored
 * source's rate-limit budget.
 *
 * Autonomous by construction: what to fetch next comes from this source's own
 * cursors, never from what the webhooks delivered. An install that can receive
 * no event converges on exactly the same state, only later.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly connectors: ConnectorFactory,
    private readonly store: StoreService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Brings a source up to date if it reads from the store, and does nothing at
   * all if it reads live — where the provider is already the answer.
   */
  async syncIfStored(sourceId: string, options: SyncOptions = {}): Promise<SyncOutcome | null> {
    const { mode } = await this.sources.readSpec(sourceId);
    if (mode !== 'stored') return null;
    return this.sync(sourceId, options);
  }

  async sync(sourceId: string, options: SyncOptions = {}): Promise<SyncOutcome> {
    const startedAt = new Date();
    const full = options.force || (await this.dueForFullSync(sourceId, startedAt));
    const depth = await this.depth(sourceId);
    const outcome: SyncOutcome = {
      full,
      skipped: false,
      repos: 0,
      pullRequests: 0,
      pipelines: 0,
      deployments: 0,
      merged: 0,
      closed: 0,
      pruned: 0,
      failed: [],
    };

    if (skipsDelta(await this.lastEventAt(sourceId), startedAt, full)) {
      // The events are demonstrably keeping the store current, so listing would
      // spend the budget to learn what is already known. The cursors are still
      // advanced — the view really is up to date — and the reconciliation clock
      // is untouched, so this can never become a source that stops being listed.
      await Promise.all(RESOURCES.map((resource) => this.mark(sourceId, resource, {
        cursor: startedAt,
        lastSyncAt: startedAt,
        lastError: null,
      })));
      outcome.skipped = true;
      this.logger.log(`Listings épargnés pour ${sourceId} : événements récents.`);
      return outcome;
    }

    const { ctx, kind } = await this.sources.resolveContext(sourceId);
    const connector = this.connectors.for(kind);

    const repos = await this.step(sourceId, 'repos', startedAt, full, outcome, async () => {
      const names = await connector.listRepositories(ctx);
      outcome.repos = await this.store.upsertRepos(
        sourceId,
        names.map((name) => ({ name })),
        startedAt,
      );
      return names;
    });
    // Everything below is scoped by the repository list: without it there is
    // nothing to ask for, and guessing from what is stored would keep a source
    // reading a scope it no longer has.
    if (repos === null) return outcome;

    const since = listingSince(startedAt, depth, full)?.toISOString();
    await this.syncPullRequests(sourceId, connector, ctx, repos, startedAt, full, depth, outcome);
    await this.syncPipelines(sourceId, connector, ctx, repos, startedAt, full, since, outcome);
    await this.syncDeployments(sourceId, connector, ctx, repos, startedAt, full, since, outcome);

    if (full) {
      outcome.pruned = await this.store.pruneOutOfScope(sourceId, repos);
    }

    this.logger.log(
      `Synchronisation ${full ? `complète (${depth} j)` : 'incrémentale'} de ${sourceId} : ` +
        `${outcome.repos} dépôt(s), ${outcome.pullRequests} PR ouverte(s), ${outcome.merged} fusionnée(s), ` +
        `${outcome.pipelines} pipeline(s), ${outcome.deployments} déploiement(s)` +
        (outcome.closed > 0 ? `, ${outcome.closed} clôturée(s)` : '') +
        (outcome.pruned > 0 ? `, ${outcome.pruned} hors périmètre supprimée(s)` : '') +
        (outcome.failed.length > 0 ? ` — en échec : ${outcome.failed.join(', ')}` : ''),
    );
    return outcome;
  }

  /**
   * The open listing and the merged one write the same rows, so they share a
   * cursor: `pulls` is up to date only once both have run.
   *
   * The reconciliation lives here rather than in the full pass: this listing is
   * complete by construction — the connector reports every open pull request of
   * every repository, or throws — so anything stored as open that it did not
   * report has moved on. Running it every time is what stops a missed event
   * from leaving one on the board for good.
   */
  private async syncPullRequests(
    sourceId: string,
    connector: SourceConnector,
    ctx: ConnectorContext,
    repos: string[],
    startedAt: Date,
    full: boolean,
    depth: number,
    outcome: SyncOutcome,
  ): Promise<void> {
    const since = await this.mergedFrom(sourceId, startedAt, depth, full);
    await this.step(sourceId, 'pulls', startedAt, full, outcome, async () => {
      const open = await connector.listPullRequests(ctx, repos);
      outcome.pullRequests = await this.store.upsertPullRequests(sourceId, open, startedAt);
      outcome.closed = await this.store.closeStalePullRequests(sourceId, startedAt, startedAt);

      const merged = await connector.listMergedPullRequests(ctx, repos, since);
      outcome.merged = await this.store.upsertMergedPullRequests(sourceId, merged, startedAt);
      return true;
    });
  }

  private async syncPipelines(
    sourceId: string,
    connector: SourceConnector,
    ctx: ConnectorContext,
    repos: string[],
    startedAt: Date,
    full: boolean,
    since: string | undefined,
    outcome: SyncOutcome,
  ): Promise<void> {
    await this.step(sourceId, 'pipelines', startedAt, full, outcome, async () => {
      const items = await connector.listPipelines(ctx, repos, since);
      outcome.pipelines = await this.store.upsertPipelines(sourceId, items, startedAt);
      return true;
    });
  }

  private async syncDeployments(
    sourceId: string,
    connector: SourceConnector,
    ctx: ConnectorContext,
    repos: string[],
    startedAt: Date,
    full: boolean,
    since: string | undefined,
    outcome: SyncOutcome,
  ): Promise<void> {
    await this.step(sourceId, 'deployments', startedAt, full, outcome, async () => {
      const items = await connector.listDeployments(ctx, repos, since);
      outcome.deployments = await this.store.upsertDeployments(sourceId, items, startedAt);
      return true;
    });
  }

  /**
   * Runs one listing and records how it went.
   *
   * A failure is recorded and swallowed: one endpoint refused by a permission
   * must not cost the three that answered, exactly as the dashboard degrades a
   * failed call into a warning. What it costs is the cursor — which is not
   * advanced — so the next run re-reads the same window.
   */
  private async step<T>(
    sourceId: string,
    resource: SyncResource,
    at: Date,
    full: boolean,
    outcome: SyncOutcome,
    run: () => Promise<T>,
  ): Promise<T | null> {
    try {
      const result = await run();
      await this.mark(sourceId, resource, {
        cursor: at,
        lastSyncAt: at,
        lastError: null,
        ...(full ? { lastFullSyncAt: at } : {}),
      });
      return result;
    } catch (e) {
      outcome.failed.push(resource);
      const message = asMessage(e);
      this.logger.warn(`Synchronisation de ${resource} échouée (${sourceId}) : ${message}`);
      await this.mark(sourceId, resource, { lastError: message });
      return null;
    }
  }

  /** Lower bound of the merged listing — see `mergedSince` for the rule. */
  private async mergedFrom(
    sourceId: string,
    now: Date,
    depth: number,
    full: boolean,
  ): Promise<string> {
    const state = await this.prisma.syncState.findUnique({
      where: { sourceId_resource: { sourceId, resource: 'pulls' } },
      select: { cursor: true },
    });
    return mergedSince(state?.cursor ?? null, now, depth, full).toISOString();
  }

  /** How far back this source is ingested — see `depthDays` for the rule. */
  private async depth(sourceId: string): Promise<number> {
    const [{ historyDays }, { doraWindowDays }] = await Promise.all([
      this.sources.readSpec(sourceId),
      this.settings.get(),
    ]);
    return depthDays(historyDays, doraWindowDays);
  }

  /**
   * When this source last heard from its provider, or null if it never has —
   * which is every source with the webhooks off, and every install whose
   * network refuses inbound traffic.
   */
  private async lastEventAt(sourceId: string): Promise<Date | null> {
    const last = await this.prisma.webhookDelivery.findFirst({
      where: { sourceId },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    });
    return last?.receivedAt ?? null;
  }

  private async dueForFullSync(sourceId: string, now: Date): Promise<boolean> {
    const rows = await this.prisma.syncState.findMany({
      where: { sourceId },
      select: { lastFullSyncAt: true },
    });
    return isDueForFullSync(
      rows.map((row) => row.lastFullSyncAt),
      now,
    );
  }

  private async mark(
    sourceId: string,
    resource: SyncResource,
    data: {
      cursor?: Date;
      lastSyncAt?: Date;
      lastFullSyncAt?: Date;
      lastError?: string | null;
    },
  ): Promise<void> {
    await this.prisma.syncState.upsert({
      where: { sourceId_resource: { sourceId, resource } },
      create: { sourceId, resource, ...data },
      update: data,
    });
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
