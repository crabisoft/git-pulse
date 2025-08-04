import { Injectable, NotFoundException } from '@nestjs/common';
import type { ScopeRules, SourceKind, SourcePublic } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import type { ConnectorContext } from './connectors/source-connector.interface';
import { ConnectorFactory } from './connectors/connector.factory';
import type { CreateSourceDto } from './dto/create-source.dto';

@Injectable()
export class SourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly connectors: ConnectorFactory,
  ) {}

  async create(dto: CreateSourceDto): Promise<SourcePublic> {
    const enc = this.crypto.encrypt(dto.secret);
    const source = await this.prisma.source.create({
      data: {
        name: dto.name,
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

  async findAll(): Promise<SourcePublic[]> {
    const sources = await this.prisma.source.findMany({ orderBy: { createdAt: 'asc' } });
    return sources.map(toPublic);
  }

  async findOne(id: string): Promise<SourcePublic> {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) throw new NotFoundException(`Source ${id} introuvable`);
    return toPublic(source);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.source.delete({ where: { id } }).catch(() => {
      throw new NotFoundException(`Source ${id} introuvable`);
    });
  }

  /** Tests the connection, decrypting the secret on the fly. */
  async testConnection(id: string): Promise<{ ok: boolean; message: string }> {
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
    if (!source) throw new NotFoundException(`Source ${id} introuvable`);
    if (!source.credential) {
      throw new NotFoundException(`Aucun secret enregistré pour la source ${id}`);
    }
    const token = this.crypto.decrypt({
      ciphertext: source.credential.ciphertext,
      iv: source.credential.iv,
      authTag: source.credential.authTag,
      keyVersion: source.credential.keyVersion,
    });
    return {
      kind: source.kind as SourceKind,
      ctx: {
        baseUrl: source.baseUrl,
        token,
        scope: source.scope as unknown as ScopeRules,
      },
    };
  }
}

/** Maps a Prisma row to the public shape (without the secret). */
function toPublic(s: {
  id: string;
  name: string;
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
    kind: s.kind as SourceKind,
    baseUrl: s.baseUrl,
    authKind: s.authKind as SourcePublic['authKind'],
    scope: s.scope as ScopeRules,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
