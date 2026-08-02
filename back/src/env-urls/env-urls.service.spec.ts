import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { CodedException } from '../common/coded-exception';
import { EnvUrlsService } from './env-urls.service';

/** A row as Prisma hands one back, for the mappers the writes end on. */
function environmentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'me-1',
    sourceId: 'src-1',
    repo: '',
    environment: 'contoso-onsite',
    url: 'https://contoso.example.com',
    attributes: {},
    mode: 'fill',
    createdAt: new Date('2026-08-01T09:00:00Z'),
    updatedAt: new Date('2026-08-01T09:00:00Z'),
    ...over,
  };
}

function ruleRow(over: Record<string, unknown> = {}) {
  return {
    id: 'eu-1',
    name: 'Client host',
    pattern: '^(?<client>[a-z]+)-prod$',
    repo: null,
    urlTemplate: 'https://{client}.example.com',
    mode: 'fill',
    priority: 100,
    createdAt: new Date('2026-08-01T09:00:00Z'),
    updatedAt: new Date('2026-08-01T09:00:00Z'),
    ...over,
  };
}

/** The service with its writes recorded rather than run. */
function service() {
  const written: Record<string, unknown>[] = [];
  const prisma = {
    manualEnvironment: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        written.push(args.data);
        return Promise.resolve(environmentRow(args.data));
      }),
      update: vi.fn((args: { data: Record<string, unknown> }) => {
        written.push(args.data);
        return Promise.resolve(environmentRow(args.data));
      }),
    },
    envUrlRule: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        written.push(args.data);
        return Promise.resolve(ruleRow(args.data));
      }),
    },
  } as unknown as PrismaService;

  return { envUrls: new EnvUrlsService(prisma), written };
}

/** The code of what was refused, or null when nothing was. */
async function refusal(write: Promise<unknown>): Promise<string | null> {
  return write.then(
    () => null,
    (err: unknown) =>
      err instanceof CodedException
        ? ((err.getResponse() as { code?: string }).code ?? null)
        : String(err),
  );
}

describe('a declared address', () => {
  it('is stored when it is somewhere a browser can go', async () => {
    const { envUrls, written } = service();

    await envUrls.createEnvironment('src-1', {
      environment: 'contoso-onsite',
      url: 'https://contoso.example.com',
    });

    expect(written[0]).toMatchObject({ url: 'https://contoso.example.com' });
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '/settings/users'])(
    'is refused when it is %s',
    async (url) => {
      // It travels to the deployment list and the boards as a link: a
      // `javascript:` address stated here would be a script every reader runs,
      // and the rules cannot produce one — a declaration must not be the way in
      // that they are not.
      const { envUrls, written } = service();

      const code = await refusal(envUrls.createEnvironment('src-1', { environment: 'x', url }));

      expect(code).toBe('errors.manualEnvironment.urlNotAddressable');
      expect(written).toEqual([]);
    },
  );

  it('is refused on an update as firmly as on a creation', async () => {
    const { envUrls, written } = service();

    const code = await refusal(envUrls.updateEnvironment('me-1', { url: 'javascript:alert(1)' }));

    expect(code).toBe('errors.manualEnvironment.urlNotAddressable');
    expect(written).toEqual([]);
  });

  it('may be withdrawn, which is not an address to check', async () => {
    // Empty withdraws the address without withdrawing the environment, and
    // undefined leaves the stored one alone. Neither is a bad address.
    const { envUrls } = service();

    expect(await refusal(envUrls.updateEnvironment('me-1', { url: '' }))).toBeNull();
    expect(await refusal(envUrls.updateEnvironment('me-1', { mode: 'overwrite' }))).toBeNull();
  });
});

describe('a rule worth saving', () => {
  it('is refused a template that cannot produce an address', async () => {
    const { envUrls } = service();

    const code = await refusal(
      envUrls.createRule({
        name: 'Relative',
        pattern: '^prod$',
        urlTemplate: '/environments/{environment}',
      }),
    );

    expect(code).toBe('errors.envUrlRule.urlNotAddressable');
  });

  it('is refused a pattern nobody can read, rather than storing one that never fires', async () => {
    // Stored, it would be applied to every listing and quietly produce nothing
    // — which looks exactly like a platform that published no address.
    const { envUrls } = service();

    const code = await refusal(
      envUrls.createRule({
        name: 'Broken',
        pattern: '^(?<client>[a-z]+',
        urlTemplate: 'https://{client}.example.com',
      }),
    );

    expect(code).toBe('errors.envUrlRule.invalidPattern');
  });

  it('is refused a repo pattern nobody can read either', async () => {
    const { envUrls } = service();

    const code = await refusal(
      envUrls.createRule({
        name: 'Broken repo',
        pattern: '^prod$',
        repo: '[unclosed',
        urlTemplate: 'https://example.com',
      }),
    );

    expect(code).toBe('errors.envUrlRule.invalidPattern');
  });
});
