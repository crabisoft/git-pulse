import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { ApiQuotaService } from './api-quota.service';
import type { QuotaSample } from './rate-limit-headers';

const SUBJECT = { kind: 'source', id: 'src-1' } as const;
const RESET = new Date('2026-07-26T13:00:00Z');

function sample(over: Partial<QuotaSample> = {}): QuotaSample {
  return { bucket: 'core', limit: 5000, used: 100, resetAt: RESET, windowSec: 3600, ...over };
}

function service() {
  const upsert = vi.fn().mockResolvedValue(undefined);
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = { apiQuota: { upsert, deleteMany } } as unknown as PrismaService;
  return { quotas: new ApiQuotaService(prisma), upsert, deleteMany };
}

/** What a flush ended up writing for a bucket. */
function written(upsert: ReturnType<typeof vi.fn>) {
  return upsert.mock.calls.map(([arg]) => arg.update);
}

describe('ApiQuotaService', () => {
  it('keeps the highest count of a window, whatever order responses come back in', async () => {
    const { quotas, upsert } = service();

    quotas.record(SUBJECT, sample({ used: 240 }));
    // Concurrent calls resolve out of order; this one was issued earlier and
    // says less was spent, which does not mean the budget came back.
    quotas.record(SUBJECT, sample({ used: 180 }));
    await quotas.flush();

    expect(written(upsert)).toEqual([expect.objectContaining({ used: 240 })]);
  });

  it('follows the drop when the window rolls over', async () => {
    const { quotas, upsert } = service();
    const next = new Date(RESET.getTime() + 3600_000);

    quotas.record(SUBJECT, sample({ used: 4980 }));
    quotas.record(SUBJECT, sample({ used: 3, resetAt: next }));
    await quotas.flush();

    expect(written(upsert)).toEqual([expect.objectContaining({ used: 3, resetAt: next })]);
  });

  it('meters each bucket on its own', async () => {
    const { quotas, upsert } = service();

    quotas.record(SUBJECT, sample({ bucket: 'core', used: 300 }));
    quotas.record(SUBJECT, sample({ bucket: 'search', limit: 30, used: 4, windowSec: 60 }));
    await quotas.flush();

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(written(upsert)).toEqual([
      expect.objectContaining({ used: 300 }),
      expect.objectContaining({ used: 4, windowSec: 60 }),
    ]);
  });

  it('holds a reading a failed write lost, rather than dropping the window', async () => {
    const { quotas, upsert } = service();
    upsert.mockRejectedValueOnce(new Error('database is down'));

    quotas.record(SUBJECT, sample({ used: 300 }));
    await quotas.flush();
    await quotas.flush();

    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('drops the readings of a forgotten subject before they are written', async () => {
    const { quotas, upsert, deleteMany } = service();

    quotas.record(SUBJECT, sample({ used: 300 }));
    await quotas.forget(SUBJECT);
    await quotas.flush();

    expect(deleteMany).toHaveBeenCalledWith({
      where: { subjectKind: 'source', subjectId: 'src-1' },
    });
    // A held reading would otherwise write the deleted source back in.
    expect(upsert).not.toHaveBeenCalled();
  });

  it('bills through a sink that knows the subject, so connectors need not', async () => {
    const { quotas, upsert } = service();

    quotas.sinkFor({ kind: 'tracker', id: 'trk-9' })(sample({ used: 12 }));
    await quotas.flush();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ subjectKind: 'tracker', subjectId: 'trk-9' }),
      }),
    );
  });
});
