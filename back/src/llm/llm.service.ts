import { Injectable, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  LLM_BASE_URLS,
  type ConnectionTestResult,
  type LlmKind,
  type LlmProviderPublic,
  type Page,
} from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsService } from '../crypto/credentials.service';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import { LlmFactory } from './llm.factory';
import type { LlmContext, LlmRequest } from './llm-provider.interface';
import { asMessage } from './providers/http.util';
import type { CreateLlmProviderDto } from './dto/create-llm-provider.dto';
import type { UpdateLlmProviderDto } from './dto/update-llm-provider.dto';

/** A completion, and which provider produced it. */
export interface LlmAnswer {
  text: string;
  provider: LlmProviderPublic;
}

@Injectable()
export class LlmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly providers: LlmFactory,
  ) {}

  async create(dto: CreateLlmProviderDto): Promise<LlmProviderPublic> {
    // The first provider is the default whatever the form said: a lone provider
    // nobody can reach by omitting an id would be a trap.
    const first = (await this.prisma.llmProvider.count()) === 0;
    const isDefault = first || (dto.isDefault ?? false);

    const id = randomUUID();
    const [row] = await this.prisma.$transaction([
      this.prisma.llmProvider.create({
        data: {
          id,
          name: dto.name,
          kind: dto.kind,
          model: dto.model,
          baseUrl: dto.baseUrl ?? null,
          isDefault,
        },
      }),
      this.credentials.writeOp({ type: 'llmProvider', id }, dto.apiKey),
      ...(isDefault ? [this.clearOtherDefaultsOp(id)] : []),
    ]);
    return toPublic(row, true);
  }

  async findAll(window: PageWindow): Promise<Page<LlmProviderPublic>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.llmProvider.findMany({
        orderBy: { createdAt: 'asc' },
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.llmProvider.count(),
    ]);
    const withKey = await this.credentials.heldBy(
      'llmProvider',
      rows.map((r) => r.id),
    );
    return toPage(
      rows.map((row) => toPublic(row, withKey.has(row.id))),
      total,
      window,
    );
  }

  async update(id: string, dto: UpdateLlmProviderDto): Promise<LlmProviderPublic> {
    const current = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!current) throw new CodedException('errors.llm.notFound', HttpStatus.NOT_FOUND, { id });

    // The default moves, it does not go away: clearing the flag by hand would
    // leave every caller that names no provider with nothing to reach.
    if (dto.isDefault === false && current.isDefault) {
      throw new CodedException('errors.llm.defaultRequired', HttpStatus.BAD_REQUEST);
    }
    const becomesDefault = dto.isDefault === true && !current.isDefault;

    const [row] = await this.prisma.$transaction([
      this.prisma.llmProvider.update({
        where: { id },
        data: {
          name: dto.name,
          kind: dto.kind,
          model: dto.model,
          baseUrl: dto.baseUrl,
          isDefault: becomesDefault ? true : undefined,
        },
      }),
      ...(dto.apiKey === undefined
        ? []
        : [this.credentials.writeOp({ type: 'llmProvider', id }, dto.apiKey)]),
      ...(becomesDefault ? [this.clearOtherDefaultsOp(id)] : []),
    ]);
    const withKey = await this.credentials.heldBy('llmProvider', [id]);
    return toPublic(row, withKey.has(id));
  }

  async remove(id: string): Promise<void> {
    const row = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!row) throw new CodedException('errors.llm.notFound', HttpStatus.NOT_FOUND, { id });

    await this.prisma.llmProvider.delete({ where: { id } });
    // Keyed by owner rather than by relation, so no cascade reaches it.
    await this.credentials.forget({ type: 'llmProvider', id });

    // Deleting the default promotes the oldest survivor rather than leaving the
    // install with providers none of which answers to "the default".
    if (row.isDefault) {
      const heir = await this.prisma.llmProvider.findFirst({ orderBy: { createdAt: 'asc' } });
      if (heir) {
        await this.prisma.llmProvider.update({
          where: { id: heir.id },
          data: { isDefault: true },
        });
      }
    }
  }

  /**
   * Spends one call to prove the key, the model name and the endpoint are all
   * usable — the three things a form cannot check on its own.
   */
  async testConnection(id: string): Promise<ConnectionTestResult> {
    try {
      const answer = await this.complete(id, {
        system: 'You are checking a connection. Answer with a single word.',
        prompt: 'Reply with the word OK.',
      });
      return { ok: true, message: { code: 'llm.test.ok', params: { model: answer.provider.model } } };
    } catch (e) {
      return { ok: false, message: { code: 'llm.test.failed', params: { reason: failureReason(e) } } };
    }
  }

  /**
   * One completion from the named provider, or from the default when none is
   * named. The key is decrypted here and never leaves the backend.
   */
  async complete(
    providerId: string | undefined,
    request: LlmRequest,
    signal?: AbortSignal,
  ): Promise<LlmAnswer> {
    const row = providerId
      ? await this.prisma.llmProvider.findUnique({ where: { id: providerId } })
      : await this.prisma.llmProvider.findFirst({ where: { isDefault: true } });
    if (!row) {
      throw providerId
        ? new CodedException('errors.llm.notFound', HttpStatus.NOT_FOUND, { id: providerId })
        : new CodedException('errors.llm.noProvider', HttpStatus.BAD_REQUEST);
    }

    const apiKey = await this.credentials.read({ type: 'llmProvider', id: row.id });
    if (apiKey === null) {
      throw new CodedException('errors.llm.noKey', HttpStatus.BAD_REQUEST, { id: row.id });
    }

    const kind = row.kind as LlmKind;
    const ctx: LlmContext = {
      kind,
      model: row.model,
      baseUrl: (row.baseUrl ?? LLM_BASE_URLS[kind]).replace(/\/+$/, ''),
      apiKey,
      signal,
    };
    const text = await this.providers.for(kind).complete(ctx, request);
    if (text.trim() === '') {
      throw new CodedException('errors.llm.emptyAnswer', HttpStatus.BAD_GATEWAY);
    }
    return { text, provider: toPublic(row, true) };
  }

  /** At most one default: whoever takes it clears the rest in the same write. */
  private clearOtherDefaultsOp(keptId: string) {
    return this.prisma.llmProvider.updateMany({
      where: { id: { not: keptId }, isDefault: true },
      data: { isDefault: false },
    });
  }
}

/**
 * Why a test failed, in one line. A vendor's own words when we have them —
 * "401 invalid api key" tells an admin what to fix, where the code it travels
 * under only says that something did not work.
 */
function failureReason(e: unknown): string {
  if (e instanceof CodedException) {
    const body = e.getResponse() as { code: string; params?: Record<string, unknown> };
    return String(body.params?.reason ?? body.code);
  }
  return asMessage(e);
}

function toPublic(
  row: {
    id: string;
    name: string;
    kind: string;
    model: string;
    baseUrl: string | null;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  hasKey: boolean,
): LlmProviderPublic {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as LlmKind,
    model: row.model,
    baseUrl: row.baseUrl,
    isDefault: row.isDefault,
    hasKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
