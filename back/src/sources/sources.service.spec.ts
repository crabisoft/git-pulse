import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import type { CryptoService } from '../crypto/crypto.service';
import type { CredentialsService } from '../crypto/credentials.service';
import type { ApiQuotaService } from '../api-quota/api-quota.service';
import type { SettingsService } from '../settings/settings.service';
import { ConnectorFactory } from './connectors/connector.factory';
import { SourcesService } from './sources.service';

/** A row as Prisma hands one back, with the relations the mapper reads. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'src-1',
    name: 'Acme',
    slug: 'acme',
    kind: 'github',
    baseUrl: 'https://github.com',
    authKind: 'token',
    scope: { owner: 'acme' },
    mode: 'live',
    webhooksEnabled: false,
    historyDays: null,
    isDefault: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    trackers: [],
    envRules: [],
    ...over,
  };
}

/**
 * The service with its writes recorded rather than run.
 *
 * `$transaction` hands each queued operation straight back, which is what the
 * real one resolves to — and lets the queue itself be read, since what matters
 * here is that both writes are in the same one.
 */
function service(found: ReturnType<typeof row> | null = row()) {
  const queued: Array<{ op: string; args: Record<string, unknown> }> = [];
  const prisma = {
    source: {
      findUnique: vi.fn().mockResolvedValue(found),
      update: (args: Record<string, unknown>) => {
        queued.push({ op: 'update', args });
        return row({ isDefault: true });
      },
      updateMany: (args: Record<string, unknown>) => {
        queued.push({ op: 'updateMany', args });
        return { count: 1 };
      },
    },
    $transaction: (ops: unknown[]) => Promise.resolve(ops),
  } as unknown as PrismaService;

  const sources = new SourcesService(
    prisma,
    {} as CryptoService,
    {} as CredentialsService,
    {} as ConnectorFactory,
    {} as ApiQuotaService,
    {} as SettingsService,
  );
  return { sources, queued };
}

describe('makeDefault', () => {
  it('sets the source it was given', async () => {
    const { sources, queued } = service();

    const source = await sources.makeDefault('src-1');

    expect(source.isDefault).toBe(true);
    const set = queued.find((q) => q.op === 'update');
    expect(set?.args).toMatchObject({ where: { id: 'src-1' }, data: { isDefault: true } });
  });

  it('clears whichever source held it, in the same transaction', async () => {
    // Two sources both claiming it would leave the choice to whichever the
    // database happened to return first, which is not a choice anybody made.
    const { sources, queued } = service();

    await sources.makeDefault('src-1');

    const cleared = queued.find((q) => q.op === 'updateMany');
    expect(cleared?.args).toMatchObject({
      where: { id: { not: 'src-1' }, isDefault: true },
      data: { isDefault: false },
    });
    // Both writes queued: one without the other is the state this prevents.
    expect(queued.map((q) => q.op)).toEqual(['update', 'updateMany']);
  });

  it('refuses a source that does not exist', async () => {
    // Refused before the transaction: a `where` matching nothing would clear
    // the real favourite and set none in its place.
    const { sources, queued } = service(null);

    await expect(sources.makeDefault('gone')).rejects.toMatchObject({
      response: { code: 'errors.source.notFound' },
    });
    expect(queued).toEqual([]);
  });
});
