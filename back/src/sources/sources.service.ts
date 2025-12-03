import { Injectable, HttpStatus } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  INCIDENT_TRACKER_KINDS,
  type AuthKind,
  type ScopeRules,
  type SourceKind,
  type SourceMode,
  type SourcePublic,
  type ConnectionTestResult,
  type Page,
  type TrackerKind,
  type WebhookSetup,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { CredentialsService } from '../crypto/credentials.service';
import { ApiQuotaService } from '../api-quota/api-quota.service';
import { SettingsService } from '../settings/settings.service';
import type { ConnectorContext, SourceAuth } from './connectors/source-connector.interface';
import { ConnectorFactory } from './connectors/connector.factory';
import type { CreateSourceDto } from './dto/create-source.dto';
import type { UpdateSourceDto } from './dto/update-source.dto';

@Injectable()
export class SourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly credentials: CredentialsService,
    private readonly connectors: ConnectorFactory,
    private readonly quotas: ApiQuotaService,
    private readonly settings: SettingsService,
  ) {}

  async create(dto: CreateSourceDto): Promise<SourcePublic> {
    await this.assertTrackers(dto.trackerIds, dto.incidentTrackerId);
    this.assertWebhooksAllowed(dto.mode ?? 'live', dto.webhooksEnabled ?? false);
    // The id is minted here rather than by the database: the credential no
    // longer hangs off the source relation, so the two writes need something to
    // agree on before either of them runs.
    const id = randomUUID();
    const [source] = await this.prisma.$transaction([
      this.prisma.source.create({
        include: WITH_TRACKERS,
        data: {
          id,
          trackers: { create: toBindings(dto.trackerIds, dto.incidentTrackerId) },
          envRules: { create: (dto.envRuleIds ?? []).map((ruleId) => ({ ruleId })) },
          name: dto.name,
          slug: await this.uniqueSlug(dto.name),
          kind: dto.kind,
          baseUrl: dto.baseUrl,
          authKind: dto.authKind,
          scope: dto.scope as unknown as object,
          mode: dto.mode,
          webhooksEnabled: dto.webhooksEnabled,
        },
      }),
      this.credentials.writeOp({ type: 'source', id }, credentialPlaintext(dto)),
    ]);
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

  /**
   * Where a source is read from, and what it tracks. One query rather than two:
   * this is asked on every dashboard and DORA request, and a `stored` source
   * needs nothing else — not even its credentials, which is the point.
   */
  async readSpec(id: string): Promise<{ mode: SourceMode; scope: ScopeRules }> {
    const source = await this.prisma.source.findUnique({
      where: { id },
      select: { mode: true, scope: true },
    });
    if (!source) throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id });
    return { mode: source.mode as SourceMode, scope: source.scope as unknown as ScopeRules };
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

    const newSecret =
      dto.secret !== undefined || dto.app !== undefined || authKind !== current.authKind
        ? credentialPlaintext({ authKind, secret: dto.secret, app: dto.app })
        : null;

    await this.assertTrackers(dto.trackerIds, dto.incidentTrackerId);
    // Checked against the merged state, since an update may set either key on
    // its own — switching back to `live` has to turn the events off with it.
    const mode = dto.mode ?? (current.mode as SourceMode);
    const webhooksEnabled = mode === 'stored' && (dto.webhooksEnabled ?? current.webhooksEnabled);
    this.assertWebhooksAllowed(mode, dto.webhooksEnabled ?? false);

    const renamed = dto.name !== undefined && dto.name !== current.name;
    const updateSource = this.prisma.source.update({
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
        mode,
        webhooksEnabled,
      },
    });

    // One transaction: an auth scheme that changed without its secret following
    // would authenticate wrongly rather than not at all.
    const [source] = await this.prisma.$transaction([
      updateSource,
      ...(newSecret === null ? [] : [this.credentials.writeOp({ type: 'source', id }, newSecret)]),
    ]);

    // Dropped rather than left behind: a secret nobody remembers turning off
    // would keep authenticating deliveries for a source that stopped listening.
    if (!webhooksEnabled) {
      await this.prisma.webhookSecret.deleteMany({ where: { sourceId: id } });
    }
    return toPublic(source);
  }

  /**
   * Issues a fresh webhook secret and returns it — the only moment it is
   * readable. Rotating is the same operation: the old one stops being accepted
   * the instant this returns, which is what makes a leak recoverable.
   */
  async issueWebhookSecret(id: string): Promise<WebhookSetup> {
    const source = await this.prisma.source.findUnique({
      where: { id },
      select: { mode: true, webhooksEnabled: true },
    });
    if (!source) throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id });
    if (!source.webhooksEnabled) {
      throw new CodedException('errors.source.webhooksDisabled', HttpStatus.BAD_REQUEST);
    }

    const secret = randomBytes(32).toString('base64url');
    const enc = this.crypto.encrypt(secret);
    const stored = {
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      keyVersion: enc.keyVersion,
    };
    await this.prisma.webhookSecret.upsert({
      where: { sourceId: id },
      create: { sourceId: id, ...stored },
      update: stored,
    });
    // The global prefix is part of the path: what comes back has to be usable
    // by appending it to a domain, which is the only thing the operator knows.
    return { path: `/api/webhooks/${id}`, secret };
  }

  /**
   * Refuses a combination that cannot work. Events only ever feed the store, so
   * accepting them for a source read live would be writing rows nothing reads.
   */
  private assertWebhooksAllowed(mode: SourceMode, enabled: boolean): void {
    if (enabled && mode !== 'stored') {
      throw new CodedException('errors.source.webhooksRequireStored', HttpStatus.BAD_REQUEST);
    }
  }

  async remove(id: string): Promise<void> {
    await this.prisma.source.delete({ where: { id } }).catch(() => {
      throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id });
    });
    // Quotas and credentials are keyed by owner rather than by relation, so no
    // cascade reaches either.
    await this.quotas.forget({ kind: 'source', id });
    await this.credentials.forget({ type: 'source', id });
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
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id });
    const secret = await this.credentials.read({ type: 'source', id });
    if (secret === null) {
      throw new CodedException('errors.source.noCredential', HttpStatus.NOT_FOUND, { id });
    }
    // Read once, here: the reserve is a setting, and asking the database for it
    // per pull request would cost more than the calls it saves. What it guards
    // against — the consumption — is what moves during a run, and that is read
    // from memory at every item.
    const subject = { kind: 'source' as const, id };
    const { quotaReservePct } = await this.settings.get();
    return {
      kind: source.kind as SourceKind,
      ctx: {
        baseUrl: source.baseUrl,
        auth: buildAuth(source.authKind as AuthKind, secret),
        scope: source.scope as unknown as ScopeRules,
        signal,
        // Git-hosted trackers borrow this context, so their calls are billed
        // here too — which is right: they spend this source's token.
        onQuota: this.quotas.sinkFor(subject),
        allowsOptionalCalls: () => this.quotas.allowsOptional(subject, quotaReservePct),
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
  mode: string;
  webhooksEnabled: boolean;
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
    mode: s.mode as SourceMode,
    webhooksEnabled: s.webhooksEnabled,
    envRuleIds: s.envRules.map((b) => b.ruleId),
    trackerIds: s.trackers.map((b) => b.trackerId),
    incidentTrackerId: s.trackers.find((b) => b.incidents)?.trackerId ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
