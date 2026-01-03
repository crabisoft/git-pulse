import { Injectable, HttpStatus } from '@nestjs/common';
import type {
  ClassifiedDeployment,
  Deployment,
  DeploymentBase,
  DeploymentChangelog,
  DeploymentChanges,
  DeploymentReport,
  DoraPeriod,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { paginate, type PageWindow } from '../common/pagination';
import { resolvePeriod, within, type PeriodQuery } from '../common/period';
import { ChangelogStore } from '../changelogs/changelog.store';
import type { SourceReader } from '../ingest/source-reader.interface';
import { SettingsService } from '../settings/settings.service';
import { SourcesService } from '../sources/sources.service';
import { ConnectorFactory } from '../sources/connectors/connector.factory';
import type {
  ConnectorContext,
  SourceConnector,
} from '../sources/connectors/source-connector.interface';
import { ReaderFactory } from '../ingest/reader.factory';
import { EnvRulesService } from '../env-rules/env-rules.service';
import { refUrl } from '../sources/connectors/ref-url';
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
    private readonly changelogs: ChangelogStore,
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
    const classified = await this.classifiedIn(
      sourceId,
      reader,
      scopeRepos(allRepos, query.repos),
      period,
    );

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
   *
   * The archive answers first, and only about the comparison it filed. What it
   * holds is the reading taken while the refs still existed, and on an
   * environment that has since been torn down it is the only reading anyone
   * will ever get — recomputing over a deleted branch answers nothing. A caller
   * asking for another base is asking about the platform, and goes there.
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
    if (base === 'previous') {
      const filed = await this.changelogs.find(sourceId, deploymentId);
      if (filed) return this.fromArchive(sourceId, filed);
    }

    const period = resolvePeriod(query, (await this.settings.get()).doraWindowDays);
    const reader = await this.readers.for(sourceId, signal);
    // Scoped to the one repo: the deployment and its predecessor are both in
    // there, and listing the whole scope to find two rows would be wasteful.
    const classified = await this.classifiedIn(sourceId, reader, [repo], period);
    const target = classified.find((d) => d.id === deploymentId);
    if (!target) {
      throw new CodedException('errors.deployment.notFound', HttpStatus.NOT_FOUND, {
        id: deploymentId,
      });
    }
    return this.contentsOf(sourceId, target, classified, base, customRef, signal);
  }

  /**
   * Every deployment of a period, classified, before any filter applies.
   *
   * Public for the archiver: what it files is decided over the whole window at
   * once, and each deployment's predecessor is another row of the same set.
   */
  async classified(
    sourceId: string,
    period: DoraPeriod,
    signal?: AbortSignal,
  ): Promise<ClassifiedDeployment[]> {
    const reader = await this.readers.for(sourceId, signal);
    return this.classifiedIn(sourceId, reader, await reader.listRepositories(), period);
  }

  /**
   * What one deployment carried, its base resolved among `classified`.
   *
   * Takes the list rather than loading one: the caller that walks a window of
   * deployments already holds every predecessor it is going to need, and a
   * listing per row would be a listing per row.
   */
  async contentsOf(
    sourceId: string,
    target: ClassifiedDeployment,
    classified: ClassifiedDeployment[],
    base: DeploymentBase = 'previous',
    customRef?: string,
    signal?: AbortSignal,
  ): Promise<DeploymentChanges> {
    const repo = target.repo;
    const { ctx, kind } = await this.sources.resolveContext(sourceId, signal);
    const connector = this.connectors.for(kind);
    const baseRef = await this.resolveBase(connector, ctx, repo, base, customRef, classified, target);

    // Nothing to compare against is a fact about the data, not a failure: the
    // first deployment to an environment genuinely has no predecessor.
    if (baseRef === null) {
      return {
        deployment: target,
        repo,
        head: target.ref,
        base,
        baseRef: null,
        baseRefUrl: null,
        entries: [],
        authors: 0,
        // Left empty rather than rendered: an empty range reads "no change in
        // this range", which is the opposite of what a first deployment did.
        markdown: '',
        archivedAt: null,
      };
    }

    const location = { kind, baseUrl: ctx.baseUrl, owner: ctx.scope.owner, repo };
    const commits = await connector.listCommitsBetween(ctx, repo, baseRef, target.ref);
    const entries = await this.releaseNotes.describeCommits(
      sourceId,
      connector,
      ctx,
      location,
      commits,
    );
    const { markdown } = await this.releaseNotes.render(location, baseRef, target.ref, entries);
    return {
      deployment: target,
      repo,
      head: target.ref,
      base,
      baseRef,
      baseRefUrl: refUrl(location, baseRef),
      entries,
      // Counted off the entries and not off the commits that were listed: a
      // squash is expanded into the commits it was made of, so the two no
      // longer describe the same set — and the number sits beside the list.
      authors: new Set(entries.map((entry) => entry.author)).size,
      markdown,
      archivedAt: null,
    };
  }

  /**
   * A filed changelog, read back as the question it answered.
   *
   * The environment goes through today's rules — those are configuration, and a
   * rule corrected since must apply to what it describes. Nothing else is
   * recomputed, the links least of all: they were built when the source still
   * pointed where it did, and a source re-scoped since would otherwise grow
   * links into a repo that no longer holds these commits.
   */
  private async fromArchive(
    sourceId: string,
    log: DeploymentChangelog,
  ): Promise<DeploymentChanges> {
    // A record filed without contents answers the question, in the negative:
    // the platform had already dropped the refs when the archiver got there, so
    // nothing will produce this comparison again. Reported as gone rather than
    // returned empty — an empty payload reads as "this carried nothing", which
    // is the one thing we know it did not mean.
    if (log.unreadable) {
      throw new CodedException('errors.deployment.contentsLost', HttpStatus.GONE, {
        repo: log.repo,
        ref: log.ref,
        when: log.archivedAt,
      });
    }
    const [env] = await this.envRules.classifyMany(sourceId, [log.environment]);
    return {
      deployment: {
        id: log.deploymentId,
        repo: log.repo,
        environment: log.environment,
        ref: log.ref,
        status: log.status,
        createdAt: log.deployedAt,
        environmentUrl: log.environmentUrl,
        url: log.deploymentUrl,
        attributes: env?.attributes ?? {},
        metaEnvironments: env?.metaEnvironments ?? [],
        refUrl: log.refUrl,
      },
      repo: log.repo,
      head: log.ref,
      base: log.base,
      baseRef: log.baseRef,
      baseRefUrl: log.baseRefUrl,
      entries: log.entries,
      authors: log.authors,
      markdown: log.markdown,
      archivedAt: log.archivedAt,
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

  /** The period's deployments over the given repos, classified. */
  private async classifiedIn(
    sourceId: string,
    reader: SourceReader,
    repos: string[],
    period: DoraPeriod,
  ): Promise<ClassifiedDeployment[]> {
    const raw = (await reader.listDeployments(repos)).filter((d) => within(d.createdAt, period));
    return this.classify(sourceId, raw);
  }

  /**
   * Resolves every environment name against the source's rules, in one read,
   * and attaches the page each deployed ref can be opened at.
   *
   * The ref link is built here rather than stored: it follows from the platform,
   * the base URL and the repo, and storing what we make of the data is what the
   * ingestion deliberately does not do. `readSpec` carries the three without
   * decrypting anything, so a stored source pays no more for it.
   */
  private async classify(
    sourceId: string,
    deployments: Deployment[],
  ): Promise<ClassifiedDeployment[]> {
    const names = [...new Set(deployments.map((d) => d.environment))];
    const [classified, spec] = await Promise.all([
      this.envRules.classifyMany(sourceId, names),
      this.sources.readSpec(sourceId),
    ]);
    const byName = new Map(classified.map((env) => [env.name, env]));
    return deployments.map((deployment) => {
      const env = byName.get(deployment.environment);
      return {
        ...deployment,
        attributes: env?.attributes ?? {},
        metaEnvironments: env?.metaEnvironments ?? [],
        refUrl: refUrl(
          {
            kind: spec.kind,
            baseUrl: spec.baseUrl,
            owner: spec.scope.owner,
            repo: deployment.repo,
          },
          deployment.ref,
        ),
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
