import { Injectable } from '@nestjs/common';
import type { Deployment, MergedPullRequest, Pipeline, PullRequest, ScopeRules } from '@repo/shared';
import { SourcesService } from '../sources/sources.service';
import { ConnectorFactory } from '../sources/connectors/connector.factory';
import type { ConnectorContext, SourceConnector } from '../sources/connectors/source-connector.interface';
import { applyScope } from '../sources/connectors/scope.util';
import type { SourceReader } from './source-reader.interface';
import { StoreService } from './store.service';

/** Reads a source in the moment, from its provider. The historical behaviour. */
class ConnectorReader implements SourceReader {
  readonly mode = 'live' as const;

  constructor(
    private readonly connector: SourceConnector,
    private readonly ctx: ConnectorContext,
  ) {}

  get scope(): ScopeRules {
    return this.ctx.scope;
  }

  listRepositories(): Promise<string[]> {
    return this.connector.listRepositories(this.ctx);
  }

  listPullRequests(repos: string[]): Promise<PullRequest[]> {
    return this.connector.listPullRequests(this.ctx, repos);
  }

  listPipelines(repos: string[]): Promise<Pipeline[]> {
    return this.connector.listPipelines(this.ctx, repos);
  }

  listDeployments(repos: string[], since?: string): Promise<Deployment[]> {
    return this.connector.listDeployments(this.ctx, repos, since);
  }

  listMergedPullRequests(repos: string[], since: string): Promise<MergedPullRequest[]> {
    return this.connector.listMergedPullRequests(this.ctx, repos, since);
  }

  /** Live data has no age worth reporting: it is of the instant, by definition. */
  async freshness(): Promise<Date | null> {
    return null;
  }
}

/** Reads a source from what the ingestion stored. Makes no call to a provider. */
class StoreReader implements SourceReader {
  readonly mode = 'stored' as const;

  constructor(
    private readonly store: StoreService,
    private readonly sourceId: string,
    readonly scope: ScopeRules,
  ) {}

  /**
   * Filtered again on the way out: the store holds what the last collection put
   * there, and a selection narrowed since then would otherwise keep showing the
   * repos it dropped until the next reconciliation prunes them.
   */
  async listRepositories(): Promise<string[]> {
    return applyScope(await this.store.readRepos(this.sourceId), this.scope);
  }

  listPullRequests(repos: string[]): Promise<PullRequest[]> {
    return this.store.readPullRequests(this.sourceId, repos);
  }

  listPipelines(repos: string[]): Promise<Pipeline[]> {
    return this.store.readPipelines(this.sourceId, repos);
  }

  listDeployments(repos: string[], since?: string): Promise<Deployment[]> {
    return this.store.readDeployments(this.sourceId, repos, since);
  }

  listMergedPullRequests(repos: string[], since: string): Promise<MergedPullRequest[]> {
    return this.store.readMergedPullRequests(this.sourceId, repos, since);
  }

  freshness(): Promise<Date | null> {
    return this.store.freshness(this.sourceId);
  }
}

/**
 * Hands out the reader a source's mode calls for.
 *
 * A `stored` source is resolved without ever decrypting its credentials: the
 * store has no use for them, and not touching a secret that nothing will send
 * is worth the branch on its own.
 */
@Injectable()
export class ReaderFactory {
  constructor(
    private readonly sources: SourcesService,
    private readonly connectors: ConnectorFactory,
    private readonly store: StoreService,
  ) {}

  async for(sourceId: string, signal?: AbortSignal): Promise<SourceReader> {
    const { mode, scope } = await this.sources.readSpec(sourceId);
    if (mode === 'stored') return new StoreReader(this.store, sourceId, scope);
    const { ctx, kind } = await this.sources.resolveContext(sourceId, signal);
    return new ConnectorReader(this.connectors.for(kind), ctx);
  }
}
