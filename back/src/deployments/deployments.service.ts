import { Injectable, HttpStatus } from '@nestjs/common';
import type {
  ClassifiedDeployment,
  Deployment,
  DeploymentBase,
  DeploymentChanges,
  DeploymentReport,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { paginate, type PageWindow } from '../common/pagination';
import { resolvePeriod, within, type PeriodQuery } from '../common/period';
import { SettingsService } from '../settings/settings.service';
import { SourcesService } from '../sources/sources.service';
import { ConnectorFactory } from '../sources/connectors/connector.factory';
import type {
  ConnectorContext,
  SourceConnector,
} from '../sources/connectors/source-connector.interface';
import { ReaderFactory } from '../ingest/reader.factory';
import { EnvRulesService } from '../env-rules/env-rules.service';
import { ReleaseNotesService } from '../release-notes/release-notes.service';
import { isValidGitRef } from './git-ref';
import {
  applyFilters,
  byMostRecent,
  previousDeployment,
  vocabularies,
  type DeploymentFilters,
} from './filter';

/** Everything the list route takes: a period, a scope, and the filters. */
export interface DeploymentsQuery extends PeriodQuery, DeploymentFilters {
  /** Scopes collection, exactly as on the DORA report: fewer repos, fewer calls. */
  repos?: string[];
}

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly readers: ReaderFactory,
    private readonly sources: SourcesService,
    private readonly connectors: ConnectorFactory,
    private readonly envRules: EnvRulesService,
    private readonly releaseNotes: ReleaseNotesService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Deployments over a period, classified and filtered.
   *
   * Two kinds of filter, the same split the DORA report makes: `repos` acts
   * **before** the reader, so a shorter list means fewer calls rather than
   * more; everything else acts after, on rows already in hand.
   */
  async list(
    sourceId: string,
    query: DeploymentsQuery,
    window: PageWindow,
    signal?: AbortSignal,
  ): Promise<DeploymentReport> {
    const period = resolvePeriod(query, (await this.settings.get()).doraWindowDays);
    const reader = await this.readers.for(sourceId, signal);

    const allRepos = await reader.listRepositories();
    const scoped = scopeRepos(allRepos, query.repos);
    const raw = (await reader.listDeployments(scoped)).filter((d) => within(d.createdAt, period));
    const classified = await this.classify(sourceId, raw);

    // Vocabularies before the filters, so narrowing one never empties another.
    const vocabulary = vocabularies(classified);
    const matching = applyFilters(classified, query).sort(byMostRecent);

    return {
      deployments: paginate(matching, window),
      repos: allRepos,
      environments: vocabulary.environments,
      statuses: vocabulary.statuses,
      dimensions: vocabulary.dimensions,
      period,
    };
  }

  /**
   * What a deployment carried, against the base the caller asked for. Both
   * bases answer a different question, and neither is a better default in
   * general — deploying `main` makes the `default` comparison empty, and a
   * first deployment has no `previous` to compare against.
   */
  async changes(
    sourceId: string,
    deploymentId: string,
    repo: string,
    base: DeploymentBase,
    /** The ref to compare against, when `base` is `ref`. Ignored otherwise. */
    customRef: string | undefined,
    query: PeriodQuery,
    signal?: AbortSignal,
  ): Promise<DeploymentChanges> {
    const period = resolvePeriod(query, (await this.settings.get()).doraWindowDays);
    const reader = await this.readers.for(sourceId, signal);

    // Scoped to the one repo: the deployment and its predecessor are both in
    // there, and listing the whole scope to find two rows would be wasteful.
    const raw = (await reader.listDeployments([repo])).filter((d) => within(d.createdAt, period));
    const classified = await this.classify(sourceId, raw);
    const target = classified.find((d) => d.id === deploymentId);
    if (!target) {
      throw new CodedException('errors.deployment.notFound', HttpStatus.NOT_FOUND, {
        id: deploymentId,
      });
    }

    const { ctx, kind } = await this.sources.resolveContext(sourceId, signal);
    const connector = this.connectors.for(kind);
    const baseRef = await this.resolveBase(connector, ctx, repo, base, customRef, classified, target);

    // Nothing to compare against is a fact about the data, not a failure: the
    // first deployment to an environment genuinely has no predecessor.
    if (baseRef === null) {
      return { deployment: target, repo, head: target.ref, base, baseRef: null, entries: [], authors: 0 };
    }

    const commits = await connector.listCommitsBetween(ctx, repo, baseRef, target.ref);
    const entries = await this.releaseNotes.describeCommits(
      sourceId,
      ctx.scope.owner,
      repo,
      commits,
    );
    return {
      deployment: target,
      repo,
      head: target.ref,
      base,
      baseRef,
      entries,
      authors: new Set(commits.map((c) => c.author)).size,
    };
  }

  /**
   * The ref a comparison starts from. Only `default` costs a call, and only
   * when it is the one asked for — a named ref needs nothing looked up, and a
   * previous deployment is already in the list loaded above.
   */
  private async resolveBase(
    connector: SourceConnector,
    ctx: ConnectorContext,
    repo: string,
    base: DeploymentBase,
    customRef: string | undefined,
    classified: ClassifiedDeployment[],
    target: ClassifiedDeployment,
  ): Promise<string | null> {
    if (base === 'ref') {
      // Refused here rather than passed through: a ref carrying `...` would be
      // read by the compare endpoints as a second bound, which is a different
      // question answered without saying so.
      if (!customRef || !isValidGitRef(customRef)) {
        throw new CodedException('errors.deployment.invalidRef', HttpStatus.BAD_REQUEST, {
          ref: customRef ?? '',
        });
      }
      return customRef;
    }
    if (base === 'default') return connector.defaultBranch(ctx, repo);
    return previousDeployment(classified, target)?.ref ?? null;
  }

  /** Resolves every environment name against the source's rules, in one read. */
  private async classify(
    sourceId: string,
    deployments: Deployment[],
  ): Promise<ClassifiedDeployment[]> {
    const names = [...new Set(deployments.map((d) => d.environment))];
    const classified = await this.envRules.classifyMany(sourceId, names);
    const byName = new Map(classified.map((env) => [env.name, env]));
    return deployments.map((deployment) => {
      const env = byName.get(deployment.environment);
      return {
        ...deployment,
        attributes: env?.attributes ?? {},
        metaEnvironments: env?.metaEnvironments ?? [],
      };
    });
  }
}

/** An empty or absent selection means every repo, not none. */
function scopeRepos(all: string[], wanted?: string[]): string[] {
  if (!wanted || wanted.length === 0) return all;
  const asked = new Set(wanted);
  return all.filter((repo) => asked.has(repo));
}
