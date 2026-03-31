import { Injectable } from '@nestjs/common';
import type {
  CodedMessage,
  DeploymentVersion,
  EnvironmentVersion,
  VersionProbeStatus,
} from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EnvRulesService, subjectKey } from '../env-rules/env-rules.service';
import { pairKey, type LastReading } from './pending-probes';

/** One reading, on its way to the store. */
export interface NewReading {
  repo: string;
  environment: string;
  /** Null when the reading produced none — `status` says why. */
  version: string | null;
  deploymentId: string | null;
  ref: string | null;
  ruleId: string | null;
  url: string | null;
  status: VersionProbeStatus;
  error: CodedMessage | null;
  observedAt: Date;
  /**
   * When the deployment this reading is attributed to went out.
   *
   * Present exactly when the reading is worth freezing against that
   * deployment — the prober only ever probes against successful ones, which is
   * the same line the changelog archiver draws: a failed deployment put nothing
   * on the environment, so a version read afterwards describes what was already
   * there.
   */
  deployedAt?: Date | null;
}

/**
 * The readings table, on its own.
 *
 * A module of one provider for the reason `ChangelogStore` is: the deployments
 * module reads it to say what each environment is running, while the service
 * that writes it depends on the deployments module to know which environments
 * there are. Splitting the table out is what keeps that dependency running one
 * way.
 */
@Injectable()
export class VersionReadingStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envRules: EnvRulesService,
  ) {}

  /**
   * What every environment of a source was last seen running, classified.
   *
   * The classification is attached here rather than by each caller: two pages
   * read this table, and a grid that crosses `client` has to mean the same
   * thing as a metric sliced on `client`. Resolved once per distinct (repo,
   * environment) pair, the way `DeploymentsService` does it — a source with
   * forty environments is forty pairs, not forty rule reads.
   */
  async latest(sourceId: string): Promise<EnvironmentVersion[]> {
    const rows = await this.prisma.environmentVersion.findMany({
      where: { sourceId },
      orderBy: [{ repo: 'asc' }, { environment: 'asc' }],
    });
    const classified = await this.envRules.classifyByPair(
      sourceId,
      rows.map((row) => ({ name: row.environment, repo: row.repo })),
    );
    return rows.map((row) => {
      // Both halves of the same resolution: the attributes a grid crosses on,
      // and the meta-environments a reader narrows on. Taking one and dropping
      // the other is what left the version grid ignoring the meta filter.
      const env = classified.get(subjectKey({ name: row.environment, repo: row.repo }));
      return {
        ...toPublic(row),
        attributes: env?.attributes ?? {},
        metaEnvironments: env?.metaEnvironments ?? [],
      };
    });
  }

  /** When each environment was last read, and against which deployment. */
  async lastReadings(sourceId: string): Promise<Map<string, LastReading>> {
    const rows = await this.prisma.environmentVersion.findMany({
      where: { sourceId },
      select: { repo: true, environment: true, observedAt: true, deploymentId: true },
    });
    return new Map(
      rows.map((row) => [
        pairKey(row.repo, row.environment),
        { observedAt: row.observedAt, deploymentId: row.deploymentId },
      ]),
    );
  }

  /**
   * Files a reading and says whether it was news.
   *
   * The current row is overwritten whatever the outcome — an environment that
   * stopped answering must not go on displaying last week's version, which
   * would read as a deployment that never went out. The timeline beside it is
   * appended to only when the version actually differs: a probe running every
   * quarter of an hour for a year would otherwise cost thirty-five thousand
   * rows to say that nothing shipped.
   *
   * A reading that produced no version is not a change. The environment did not
   * roll back to nothing; we simply failed to ask it.
   *
   * When the reading is attributed to a deployment, the same write freezes it
   * against that deployment — see `frozenWrite`. One path, not two: a reading
   * that reached the current state and not the frozen row would be a pair of
   * tables disagreeing about a request that was made once.
   */
  async record(sourceId: string, reading: NewReading): Promise<boolean> {
    const existing = await this.prisma.environmentVersion.findUnique({
      where: {
        sourceId_repo_environment: {
          sourceId,
          repo: reading.repo,
          environment: reading.environment,
        },
      },
      select: { version: true, changedAt: true },
    });
    const changed = reading.version !== null && reading.version !== existing?.version;

    const row = {
      version: reading.version,
      deploymentId: reading.deploymentId,
      ref: reading.ref,
      ruleId: reading.ruleId,
      url: reading.url,
      status: reading.status,
      error: (reading.error ?? undefined) as object | undefined,
      observedAt: reading.observedAt,
      changedAt: changed ? reading.observedAt : (existing?.changedAt ?? null),
    };

    await this.prisma.$transaction([
      this.prisma.environmentVersion.upsert({
        where: {
          sourceId_repo_environment: {
            sourceId,
            repo: reading.repo,
            environment: reading.environment,
          },
        },
        create: {
          sourceId,
          repo: reading.repo,
          environment: reading.environment,
          ...row,
        },
        update: row,
      }),
      ...(changed
        ? [
            this.prisma.versionChange.create({
              data: {
                sourceId,
                repo: reading.repo,
                environment: reading.environment,
                version: reading.version as string,
                deploymentId: reading.deploymentId,
                ref: reading.ref,
                observedAt: reading.observedAt,
              },
            }),
          ]
        : []),
      ...this.frozenWrite(sourceId, reading),
    ]);
    return changed;
  }

  /**
   * The reading, frozen against the deployment it describes.
   *
   * An **upsert**, and that is the whole design: a later reading of the same
   * deployment is better evidence than an earlier one. The first probe can
   * catch an application mid-restart and read the version it is replacing —
   * and unlike everything else here, that mistake would otherwise be permanent,
   * since the current-state row corrects itself at the next reading and a
   * frozen one has no next reading to be corrected by.
   *
   * Nothing is written when the reading names no deployment: there is nothing
   * to freeze it against.
   */
  private frozenWrite(sourceId: string, reading: NewReading) {
    if (!reading.deploymentId || !reading.deployedAt) return [];

    const frozen = {
      repo: reading.repo,
      environment: reading.environment,
      ref: reading.ref ?? '',
      deployedAt: reading.deployedAt,
      version: reading.version,
      ruleId: reading.ruleId,
      url: reading.url,
      status: reading.status,
      error: (reading.error ?? undefined) as object | undefined,
      observedAt: reading.observedAt,
      // Recomputed rather than carried, so it can never disagree with the pair
      // of timestamps beside it. Floored at zero: a provider clock running
      // ahead of ours must not produce a reading taken before its deployment.
      delaySec: Math.max(
        0,
        Math.round((reading.observedAt.getTime() - reading.deployedAt.getTime()) / 1000),
      ),
    };

    return [
      this.prisma.deploymentVersion.upsert({
        where: { sourceId_deploymentId: { sourceId, deploymentId: reading.deploymentId } },
        create: { sourceId, deploymentId: reading.deploymentId, ...frozen },
        update: frozen,
      }),
    ];
  }

  /**
   * How many version rules a source has attached.
   *
   * Here rather than on `VersionRulesService`, which is where it belongs by
   * subject: that service lives in a module which depends on the deployments
   * module, and the deployments module is what needs to ask. A count of rows in
   * a join table needs neither the rules nor their secrets, so it costs this
   * table's module nothing to answer.
   *
   * What it is for: telling "this source reads no versions" apart from "it
   * reads versions and none have been taken yet". Those look identical from
   * every list of readings, and only the second one is worth showing a column
   * for.
   */
  async rulesAttached(sourceId: string): Promise<number> {
    return this.prisma.sourceVersionRule.count({ where: { sourceId } });
  }

  /**
   * What was frozen against each of these deployments.
   *
   * Asked for by id rather than over a window: the page holds the deployments
   * it is showing, and a row survives the sweep that takes the deployment
   * itself — so "everything since" would answer about rows whose deployment is
   * long gone.
   */
  async frozenFor(sourceId: string, deploymentIds: string[]): Promise<DeploymentVersion[]> {
    if (deploymentIds.length === 0) return [];
    const rows = await this.prisma.deploymentVersion.findMany({
      where: { sourceId, deploymentId: { in: deploymentIds } },
    });
    return rows.map(toFrozen);
  }
}

function toPublic(row: {
  repo: string;
  environment: string;
  version: string | null;
  deploymentId: string | null;
  ref: string | null;
  ruleId: string | null;
  url: string | null;
  status: string;
  error: unknown;
  observedAt: Date;
  changedAt: Date | null;
}): EnvironmentVersion {
  return {
    repo: row.repo,
    environment: row.environment,
    version: row.version,
    deploymentId: row.deploymentId,
    ref: row.ref,
    ruleId: row.ruleId,
    url: row.url,
    status: row.status as VersionProbeStatus,
    error: toCodedMessage(row.error),
    // Filled by `latest`, which is the only reader that has the rules in hand.
    attributes: {},
    metaEnvironments: [],
    observedAt: row.observedAt.toISOString(),
    changedAt: row.changedAt?.toISOString() ?? null,
  };
}

function toFrozen(row: {
  deploymentId: string;
  repo: string;
  environment: string;
  ref: string;
  deployedAt: Date;
  version: string | null;
  ruleId: string | null;
  url: string | null;
  status: string;
  error: unknown;
  observedAt: Date;
  delaySec: number;
}): DeploymentVersion {
  return {
    deploymentId: row.deploymentId,
    repo: row.repo,
    environment: row.environment,
    ref: row.ref,
    deployedAt: row.deployedAt.toISOString(),
    version: row.version,
    ruleId: row.ruleId,
    url: row.url,
    status: row.status as VersionProbeStatus,
    error: toCodedMessage(row.error),
    observedAt: row.observedAt.toISOString(),
    delaySec: row.delaySec,
  };
}

/** Prisma hands the JSON column back as `unknown`; anything shapeless reads as none. */
function toCodedMessage(value: unknown): CodedMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { code, params } = value as { code?: unknown; params?: unknown };
  if (typeof code !== 'string') return null;
  return {
    code,
    ...(typeof params === 'object' && params !== null && !Array.isArray(params)
      ? { params: params as Record<string, string | number> }
      : {}),
  };
}
