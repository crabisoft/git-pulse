import { Injectable, Logger, OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ApiQuotaPublic, QuotaOrigin } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ApiBudgetService } from './api-budget.service';
import type { QuotaSample, QuotaSink } from './rate-limit-headers';
import {
  allowsOptionalWork,
  countCall,
  remainingShare,
  subjectKey,
  type Reading,
  type QuotaSubjectRef,
} from './quota-pressure';

export type { QuotaSubjectRef };

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
 * Two ways in. A provider that meters its API is **read**: its counters come
 * back on every response and are recorded as observed. One that meters nothing
 * is **counted** here instead, against the ceiling an admin declared — a
 * supposition, marked as such, and dropped the moment a real reading turns up
 * for that subject.
 *
 * The readings outlive their write, which is what lets a run be steered by
 * them: `allowsOptional` answers from memory, on the response path, with no
 * query in sight.
 */
@Injectable()
export class ApiQuotaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiQuotaService.name);
  /** Latest reading per subject and bucket — kept after the write, not cleared. */
  private readonly current = new Map<string, { subject: QuotaSubjectRef; reading: Reading }>();
  /** Keys whose reading has changed since the last successful write. */
  private readonly dirty = new Set<string>();
  /** Subjects the provider meters itself: their declared budget is ignored. */
  private readonly metered = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly budgets: ApiBudgetService,
  ) {}

  /**
   * Restores what was known before the restart. Without it the first run back
   * would spend its optional calls on a budget it cannot see yet, which is the
   * one moment the degradation exists for.
   */
  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.prisma.apiQuota.findMany();
      for (const row of rows) {
        const subject: QuotaSubjectRef = {
          kind: row.subjectKind as QuotaSubjectRef['kind'],
          id: row.subjectId,
        };
        const origin = row.origin as QuotaOrigin;
        this.current.set(keyOf(subject, row.bucket), {
          subject,
          reading: {
            origin,
            sample: {
              bucket: row.bucket,
              limit: row.limit,
              used: row.used,
              resetAt: row.resetAt,
              windowSec: row.windowSec,
            },
          },
        });
        if (origin === 'observed') this.metered.add(subjectKey(subject));
      }
    } catch (e) {
      this.logger.warn(`Quotas non rechargés au démarrage : ${asMessage(e)}`);
    }
  }

  /**
   * A sink bound to one subject, for a connector to call on every response.
   * The connectors stay unaware of subjects: they report what they read, and
   * the closure knows whose budget it charges.
   */
  sinkFor(subject: QuotaSubjectRef): QuotaSink {
    return (sample) => this.record(subject, sample);
  }

  /**
   * Takes one reading, or counts one unmetered call. Never throws and never
   * awaits: it sits on the response path of every API call, where a metering
   * failure must not become a collection failure.
   */
  record(subject: QuotaSubjectRef, sample: QuotaSample | null): void {
    if (sample === null) {
      this.countAgainstBudget(subject);
      return;
    }

    // A measurement settles the question: whatever was declared for this
    // subject stops being counted. The declared row is overwritten as soon as
    // the provider meters the bucket it was declared for, which is the bucket
    // the UI offers — an instance metering some other one keeps a stale row
    // until its window elapses, where the gauge draws it as expired.
    this.metered.add(subjectKey(subject));

    const key = keyOf(subject, sample.bucket);
    const held = this.current.get(key)?.reading;
    // Responses come back out of order, and these headers are counters rather
    // than increments: the highest count of a window is the current one. A later
    // reset date means the window rolled over, where a lower count is expected.
    const stale =
      held !== undefined &&
      held.origin === 'observed' &&
      sample.resetAt.getTime() <= held.sample.resetAt.getTime() &&
      sample.used < held.sample.used;
    if (stale) return;

    this.hold(key, subject, { sample, origin: 'observed' });
  }

  /**
   * Drops everything known about a subject, declaration included. The
   * polymorphic key rules out a foreign key, so the rows of a deleted source
   * have to be cleared here — including the readings still held, which would
   * otherwise write themselves back after the deletion.
   */
  async forget(subject: QuotaSubjectRef): Promise<void> {
    const prefix = `${subjectKey(subject)}:`;
    for (const key of this.current.keys()) {
      if (key.startsWith(prefix)) {
        this.current.delete(key);
        this.dirty.delete(key);
      }
    }
    this.metered.delete(subjectKey(subject));
    await this.budgets.forget(subject);
    await this.prisma.apiQuota.deleteMany({
      where: { subjectKind: subject.kind, subjectId: subject.id },
    });
  }

  /**
   * Share of the budget a subject has left, over the buckets whose window is
   * still running. Null when nothing has been read or counted yet.
   */
  share(subject: QuotaSubjectRef, now: Date = new Date()): number | null {
    const prefix = `${subjectKey(subject)}:`;
    const readings: Reading[] = [];
    for (const [key, held] of this.current) {
      if (key.startsWith(prefix)) readings.push(held.reading);
    }
    return remainingShare(readings, now);
  }

  /**
   * Whether a subject may still be charged for optional work — the enrichment
   * calls that fan out per pull request and per deployment. Synchronous: it is
   * asked in the middle of a loop over hundreds of items.
   */
  allowsOptional(subject: QuotaSubjectRef, reservePct: number, now: Date = new Date()): boolean {
    return allowsOptionalWork(this.share(subject, now), reservePct);
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
    for (const key of [...this.dirty]) {
      const held = this.current.get(key);
      if (!held) {
        this.dirty.delete(key);
        continue;
      }
      const { subject, reading } = held;
      const data = {
        limit: Math.trunc(reading.sample.limit),
        used: Math.trunc(reading.sample.used),
        resetAt: reading.sample.resetAt,
        windowSec: reading.sample.windowSec,
        origin: reading.origin,
      };
      try {
        await this.prisma.apiQuota.upsert({
          where: {
            subjectKind_subjectId_bucket: {
              subjectKind: subject.kind,
              subjectId: subject.id,
              bucket: reading.sample.bucket,
            },
          },
          create: {
            subjectKind: subject.kind,
            subjectId: subject.id,
            bucket: reading.sample.bucket,
            ...data,
          },
          update: data,
        });
        // Cleared only once written: a failed flush keeps its reading for the
        // next one rather than losing the window it measured.
        this.dirty.delete(key);
      } catch (e) {
        this.logger.warn(`Quota non enregistré pour ${key} : ${asMessage(e)}`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  /**
   * Counts a call the provider reported nothing about, against the ceiling
   * declared for its subject. With no declaration there is nothing to count
   * against: the call is real, but no number would describe what it consumed.
   */
  private countAgainstBudget(subject: QuotaSubjectRef): void {
    if (this.metered.has(subjectKey(subject))) return;
    const budget = this.budgets.for(subject);
    if (!budget) return;

    const key = keyOf(subject, budget.bucket);
    const held = this.current.get(key)?.reading;
    const counted = held?.origin === 'declared' ? held.sample : undefined;
    const sample = countCall(counted, budget, new Date());
    this.hold(key, subject, { sample, origin: 'declared' });
  }

  private hold(key: string, subject: QuotaSubjectRef, reading: Reading): void {
    this.current.set(key, { subject, reading });
    this.dirty.add(key);
    this.scheduleFlush();
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

/** Addresses one bucket of one subject in the in-memory maps. */
function keyOf(subject: QuotaSubjectRef, bucket: string): string {
  return `${subjectKey(subject)}:${bucket}`;
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
