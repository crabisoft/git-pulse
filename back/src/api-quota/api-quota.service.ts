import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ApiQuotaPublic, QuotaSubject } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { QuotaSample, QuotaSink } from './rate-limit-headers';

/** Whose credentials a series of calls is billed to. */
export interface QuotaSubjectRef {
  kind: QuotaSubject;
  id: string;
}

/**
 * How long observations are held before being written. A collection run makes
 * hundreds of calls in a burst and every one of them carries the counters, so
 * writing on each would turn a metering feature into a write amplifier — for
 * data whose only reader is a gauge refreshed by hand.
 */
const FLUSH_DELAY_MS = 2_000;

/**
 * Keeps track of what each source consumes of its provider's rate limit.
 *
 * Observation only: nothing here throttles or refuses a call. It answers "where
 * do I stand", which is the question that has to be answerable before deciding
 * what to do about it.
 */
@Injectable()
export class ApiQuotaService implements OnModuleDestroy {
  private readonly logger = new Logger(ApiQuotaService.name);
  /** Latest observation per subject and bucket, awaiting a write. */
  private readonly pending = new Map<string, { subject: QuotaSubjectRef; sample: QuotaSample }>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A sink bound to one subject, for a connector to call on every response.
   * The connectors stay unaware of subjects: they report what they read, and
   * the closure knows whose budget it charges.
   */
  sinkFor(subject: QuotaSubjectRef): QuotaSink {
    return (sample) => this.record(subject, sample);
  }

  /**
   * Takes one reading. Never throws and never awaits: it sits on the response
   * path of every API call, where a metering failure must not become a
   * collection failure.
   */
  record(subject: QuotaSubjectRef, sample: QuotaSample): void {
    const key = `${subject.kind}:${subject.id}:${sample.bucket}`;
    const held = this.pending.get(key)?.sample;
    // Responses come back out of order, and these headers are counters rather
    // than increments: the highest count of a window is the current one. A later
    // reset date means the window rolled over, where a lower count is expected.
    const stale =
      held !== undefined &&
      sample.resetAt.getTime() <= held.resetAt.getTime() &&
      sample.used < held.used;
    if (stale) return;

    this.pending.set(key, { subject, sample });
    this.scheduleFlush();
  }

  /**
   * Drops everything known about a subject. The polymorphic key rules out a
   * foreign key, so the rows of a deleted source have to be cleared here —
   * including the readings still held, which would otherwise write themselves
   * back after the deletion.
   */
  async forget(subject: QuotaSubjectRef): Promise<void> {
    const prefix = `${subject.kind}:${subject.id}:`;
    for (const key of this.pending.keys()) {
      if (key.startsWith(prefix)) this.pending.delete(key);
    }
    await this.prisma.apiQuota.deleteMany({
      where: { subjectKind: subject.kind, subjectId: subject.id },
    });
  }

  /** Every known quota, freshest reading first. */
  async list(): Promise<ApiQuotaPublic[]> {
    const rows = await this.prisma.apiQuota.findMany({ orderBy: { observedAt: 'desc' } });
    return rows.map(toPublic);
  }

  /**
   * Writes the held observations. Public so a caller that needs the stored
   * state to be current — a test, a shutdown — can force it.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const entries = [...this.pending.entries()];
    for (const [key, { subject, sample }] of entries) {
      const data = {
        limit: Math.trunc(sample.limit),
        used: Math.trunc(sample.used),
        resetAt: sample.resetAt,
        windowSec: sample.windowSec,
        origin: 'observed' as const,
      };
      try {
        await this.prisma.apiQuota.upsert({
          where: {
            subjectKind_subjectId_bucket: {
              subjectKind: subject.kind,
              subjectId: subject.id,
              bucket: sample.bucket,
            },
          },
          create: {
            subjectKind: subject.kind,
            subjectId: subject.id,
            bucket: sample.bucket,
            ...data,
          },
          update: data,
        });
        // Dropped only once written: a failed flush keeps its reading for the
        // next one rather than losing the window it measured.
        this.pending.delete(key);
      } catch (e) {
        this.logger.warn(`Quota non enregistré pour ${key} : ${asMessage(e)}`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
    // Metering must never be the reason the process stays alive.
    this.flushTimer.unref();
  }
}

function toPublic(row: {
  subjectKind: string;
  subjectId: string;
  bucket: string;
  limit: number;
  used: number;
  resetAt: Date;
  windowSec: number | null;
  origin: string;
  observedAt: Date;
}): ApiQuotaPublic {
  return {
    subjectKind: row.subjectKind as ApiQuotaPublic['subjectKind'],
    subjectId: row.subjectId,
    bucket: row.bucket,
    limit: row.limit,
    used: row.used,
    remaining: Math.max(0, row.limit - row.used),
    resetAt: row.resetAt.toISOString(),
    windowSec: row.windowSec,
    origin: row.origin as ApiQuotaPublic['origin'],
    observedAt: row.observedAt.toISOString(),
  };
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
