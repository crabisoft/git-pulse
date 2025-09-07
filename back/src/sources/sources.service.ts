import { Injectable, HttpStatus } from '@nestjs/common';
import type {
  AuthKind,
  ScopeRules,
  SourceKind,
  SourcePublic,
  ConnectionTestResult,
  Page,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
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
  ) {}

  async create(dto: CreateSourceDto): Promise<SourcePublic> {
    const enc = this.crypto.encrypt(credentialPlaintext(dto));
    const source = await this.prisma.source.create({
      data: {
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

  /** Every source id, for internal fan-out — deliberately not paginated. */
  async listIds(): Promise<string[]> {
    const rows = await this.prisma.source.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async findOne(id: string): Promise<SourcePublic> {
    const source = await this.prisma.source.findUnique({ where: { id } });
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

    const renamed = dto.name !== undefined && dto.name !== current.name;
    const source = await this.prisma.source.update({
      where: { id },
      data: {
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
  }

  /** Tests the connection, decrypting the secret on the fly. */
  async testConnection(id: string): Promise<ConnectionTestResult> {
    const { ctx, kind } = await this.resolveContext(id);
    return this.connectors.for(kind).testConnection(ctx);
  }

  /**
   * Resolves the connection context (decrypted secret + scope) for internal
   * use (dashboard, collection). The secret never leaves the backend.
   */
  async resolveContext(
    id: string,
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
      },
    };
  }
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
}): SourcePublic {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    kind: s.kind as SourceKind,
    baseUrl: s.baseUrl,
    authKind: s.authKind as SourcePublic['authKind'],
    scope: s.scope as ScopeRules,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
