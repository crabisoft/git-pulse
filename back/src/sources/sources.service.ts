import { Injectable, HttpStatus } from '@nestjs/common';
import {
  INCIDENT_TRACKER_KINDS,
  type AuthKind,
  type ScopeRules,
  type SourceKind,
  type SourcePublic,
  type ConnectionTestResult,
  type Page,
  type TrackerKind,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { ApiQuotaService } from '../api-quota/api-quota.service';
import type { ConnectorContext, SourceAuth } from './connectors/source-connector.interface';
import { ConnectorFactory } from './connectors/connector.factory';
import type { CreateSourceDto } from './dto/create-source.dto';
import type { UpdateSourceDto } from './dto/update-source.dto';

@Injectable()
export class SourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly connectors: ConnectorFactory,
    private readonly quotas: ApiQuotaService,
  ) {}

  async create(dto: CreateSourceDto): Promise<SourcePublic> {
    await this.assertTrackers(dto.trackerIds, dto.incidentTrackerId);
    const enc = this.crypto.encrypt(credentialPlaintext(dto));
    const source = await this.prisma.source.create({
      include: WITH_TRACKERS,
      data: {
        trackers: { create: toBindings(dto.trackerIds, dto.incidentTrackerId) },
        envRules: { create: (dto.envRuleIds ?? []).map((ruleId) => ({ ruleId })) },
        name: dto.name,
        slug: await this.uniqueSlug(dto.name),
        kind: dto.kind,
        baseUrl: dto.baseUrl,
        authKind: dto.authKind,
        scope: dto.scope as unknown as object,
        credential: {
          create: {
            ciphertext: enc.ciphertext,
            iv: enc.iv,
            authTag: enc.authTag,
            keyVersion: enc.keyVersion,
          },
        },
      },
    });
    return toPublic(source);
  }

  async findAll(window: PageWindow): Promise<Page<SourcePublic>> {
    const [sources, total] = await this.prisma.$transaction([
      this.prisma.source.findMany({
        orderBy: { createdAt: 'asc' },
        skip: window.offset,
        take: window.limit,
        include: WITH_TRACKERS,
      }),
      this.prisma.source.count(),
    ]);
    return toPage(sources.map(toPublic), total, window);
  }

  /**
   * Slugifies the name, appending a counter when another source already took
   * it — names are not unique, slugs are.
   */
  private async uniqueSlug(name: string, excludeId?: string): Promise<string> {
    const base = slugify(name);
    const siblings = await this.prisma.source.findMany({
      where: { slug: { startsWith: base }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { slug: true },
    });
    const taken = new Set(siblings.map((s) => s.slug));
    if (!taken.has(base)) return base;
    // Terminates: `taken` is finite, so some suffix is always free.
    for (let i = 2; ; i += 1) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /**
   * The incident tracker has to be one of the attached ones, and of a kind a
   * provider exists for — refused here rather than blowing up mid-collection,
   * where the user would only see an empty metric.
   */
  private async assertTrackers(
    trackerIds: string[] | undefined,
    incidentTrackerId: string | null | undefined,
  ): Promise<void> {
    if (!incidentTrackerId) return;
    if (trackerIds && !trackerIds.includes(incidentTrackerId)) {
      throw new CodedException('errors.source.incidentTrackerNotAttached', HttpStatus.BAD_REQUEST);
    }
    const tracker = await this.prisma.tracker.findUnique({
      where: { id: incidentTrackerId },
      select: { kind: true },
    });
    if (!tracker) {
      throw new CodedException('errors.tracker.notFound', HttpStatus.NOT_FOUND, {
        id: incidentTrackerId,
      });
    }
    if (!INCIDENT_TRACKER_KINDS.includes(tracker.kind as TrackerKind)) {
      throw new CodedException('errors.source.incidentTrackerUnsupported', HttpStatus.BAD_REQUEST, {
        kind: tracker.kind,
      });
    }
  }

  /** Every source id, for internal fan-out — deliberately not paginated. */
  async listIds(): Promise<string[]> {
    const rows = await this.prisma.source.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async findOne(id: string): Promise<SourcePublic> {
    const source = await this.prisma.source.findUnique({ where: { id }, include: WITH_TRACKERS });
    if (!source) throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id });
    return toPublic(source);
  }

  /**
   * Partial update. The stored secret is kept untouched unless a new one is
   * supplied — except when the auth scheme changes, which makes it unusable.
   */
  async update(id: string, dto: UpdateSourceDto): Promise<SourcePublic> {
    const current = await this.prisma.source.findUnique({ where: { id } });
    if (!current) throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id });

    const kind = dto.kind ?? (current.kind as SourceKind);
    const authKind = dto.authKind ?? (current.authKind as AuthKind);
    if (kind === 'gitlab' && authKind === 'app') {
      throw new CodedException('errors.source.appUnsupported', HttpStatus.BAD_REQUEST);
    }

    const newCredential =
      dto.secret !== undefined || dto.app !== undefined || authKind !== current.authKind
        ? this.crypto.encrypt(credentialPlaintext({ authKind, secret: dto.secret, app: dto.app }))
        : null;

    await this.assertTrackers(dto.trackerIds, dto.incidentTrackerId);
    const renamed = dto.name !== undefined && dto.name !== current.name;
    const source = await this.prisma.source.update({
      where: { id },
      include: WITH_TRACKERS,
      data: {
        // Replaced wholesale: the form always posts the full set, and a diff
        // would only add ways for the two to drift apart.
        ...(dto.trackerIds
          ? {
              trackers: {
                deleteMany: {},
                create: toBindings(dto.trackerIds, dto.incidentTrackerId),
              },
            }
          : {}),
        ...(dto.envRuleIds
          ? {
              envRules: {
                deleteMany: {},
                create: dto.envRuleIds.map((ruleId) => ({ ruleId })),
              },
            }
          : {}),
        name: dto.name,
        // The slug mirrors the name, so a rename invalidates older links.
        slug: renamed ? await this.uniqueSlug(dto.name!, id) : undefined,
        kind,
        baseUrl: dto.baseUrl,
        authKind,
        scope: dto.scope ? (dto.scope as unknown as object) : undefined,
        credential: newCredential
          ? {
              upsert: {
                create: {
                  ciphertext: newCredential.ciphertext,
                  iv: newCredential.iv,
                  authTag: newCredential.authTag,
                  keyVersion: newCredential.keyVersion,
                },
                update: {
                  ciphertext: newCredential.ciphertext,
                  iv: newCredential.iv,
                  authTag: newCredential.authTag,
                  keyVersion: newCredential.keyVersion,
                },
              },
            }
          : undefined,
      },
    });
    return toPublic(source);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.source.delete({ where: { id } }).catch(() => {
      throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id });
    });
    // Quotas are keyed by subject rather than by relation, so no cascade
    // reaches them.
    await this.quotas.forget({ kind: 'source', id });
  }

  /** Tests the connection, decrypting the secret on the fly. */
  async testConnection(id: string): Promise<ConnectionTestResult> {
    const { ctx, kind } = await this.resolveContext(id);
    const result = await this.connectors.for(kind).testConnection(ctx);
    // The one call this made carries the rate-limit counters, and a user
    // watching the result expects the gauge to follow — quota writes are
    // batched, so this is the one place worth forcing them out.
    await this.quotas.flush();
    return result;
  }

  /**
   * Resolves the connection context (decrypted secret + scope) for internal
   * use (dashboard, collection). The secret never leaves the backend.
   */
  async resolveContext(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ ctx: ConnectorContext; kind: SourceKind }> {
    const source = await this.prisma.source.findUnique({
      where: { id },
      include: { credential: true },
    });
    if (!source) throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id });
    if (!source.credential) {
      throw new CodedException('errors.source.noCredential', HttpStatus.NOT_FOUND, { id });
    }
    const secret = this.crypto.decrypt({
      ciphertext: source.credential.ciphertext,
      iv: source.credential.iv,
      authTag: source.credential.authTag,
      keyVersion: source.credential.keyVersion,
    });
    return {
      kind: source.kind as SourceKind,
      ctx: {
        baseUrl: source.baseUrl,
        auth: buildAuth(source.authKind as AuthKind, secret),
        scope: source.scope as unknown as ScopeRules,
        signal,
        // Git-hosted trackers borrow this context, so their calls are billed
        // here too — which is right: they spend this source's token.
        onQuota: this.quotas.sinkFor({ kind: 'source', id }),
      },
    };
  }
}

/** Bindings come along with every source read, so toPublic always has them. */
const WITH_TRACKERS = {
  trackers: { select: { trackerId: true, incidents: true } },
  envRules: { select: { ruleId: true } },
} as const;

/** At most one incident tracker: the single-select makes it unrepresentable. */
function toBindings(trackerIds: string[] | undefined, incidentTrackerId: string | null | undefined) {
  return (trackerIds ?? []).map((trackerId) => ({
    trackerId,
    incidents: trackerId === incidentTrackerId,
  }));
}

/**
 * URL-safe form of a name: accents dropped, lowercased, every run of other
 * characters collapsed to a single dash. Falls back to `source` for a name made
 * only of symbols, so the result is never empty.
 */
function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'source'
  );
}

/** Serializes the credential to encrypt from a create or update request. */
function credentialPlaintext(input: {
  authKind: AuthKind;
  secret?: string;
  app?: { appId: string; privateKey: string; installationId: string };
}): string {
  if (input.authKind === 'app') {
    if (!input.app) {
      throw new CodedException('errors.source.missingAppCredentials', HttpStatus.BAD_REQUEST);
    }
    return JSON.stringify(input.app);
  }
  if (!input.secret) {
    throw new CodedException('errors.source.missingToken', HttpStatus.BAD_REQUEST);
  }
  return input.secret;
}

/** Rebuilds the connector auth from stored credentials. */
function buildAuth(authKind: AuthKind, secret: string): SourceAuth {
  if (authKind === 'app') {
    const { appId, privateKey, installationId } = JSON.parse(secret) as {
      appId: string;
      privateKey: string;
      installationId: string;
    };
    return { kind: 'app', appId, privateKey, installationId };
  }
  return { kind: 'token', token: secret };
}

/** Maps a Prisma row to the public shape (without the secret). */
function toPublic(s: {
  id: string;
  name: string;
  slug: string;
  kind: string;
  baseUrl: string;
  authKind: string;
  scope: unknown;
  createdAt: Date;
  updatedAt: Date;
  trackers: Array<{ trackerId: string; incidents: boolean }>;
  envRules: Array<{ ruleId: string }>;
}): SourcePublic {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    kind: s.kind as SourceKind,
    baseUrl: s.baseUrl,
    authKind: s.authKind as SourcePublic['authKind'],
    scope: s.scope as ScopeRules,
    envRuleIds: s.envRules.map((b) => b.ruleId),
    trackerIds: s.trackers.map((b) => b.trackerId),
    incidentTrackerId: s.trackers.find((b) => b.incidents)?.trackerId ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
