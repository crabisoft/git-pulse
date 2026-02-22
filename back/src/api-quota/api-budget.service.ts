import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  QUOTA_BUCKET_BY_KIND,
  QUOTA_LIMIT_MIN,
  QUOTA_WINDOW_SEC_MAX,
  QUOTA_WINDOW_SEC_MIN,
  type ApiBudgetInput,
  type ApiBudgetPublic,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { PrismaService } from '../prisma/prisma.service';
import { subjectKey, type DeclaredBudget, type QuotaSubjectRef } from './quota-pressure';

/**
 * The ceilings declared by hand, for the instances that meter nothing.
 *
 * Held in memory as well as in the database: the counting that uses them sits
 * on the response path of every API call, where a query per call is out of the
 * question. The cache is the whole table — one row per connection at most.
 */
@Injectable()
export class ApiBudgetService implements OnModuleInit {
  private readonly logger = new Logger(ApiBudgetService.name);
  private readonly cache = new Map<string, DeclaredBudget>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A failed load leaves the cache empty rather than the process dead: no
   * budget means no local counting, which is where every install started.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.reload();
    } catch (e) {
      this.logger.warn(`API budgets not loaded: ${asMessage(e)}`);
    }
  }

  /** The budget declared for a subject, if any. Synchronous by design. */
  for(subject: QuotaSubjectRef): DeclaredBudget | undefined {
    return this.cache.get(subjectKey(subject));
  }

  async list(): Promise<ApiBudgetPublic[]> {
    const rows = await this.prisma.apiBudget.findMany({ orderBy: { updatedAt: 'desc' } });
    return rows.map(toPublic);
  }

  /**
   * Declares or replaces the ceiling of a subject. The bucket travels with it
   * rather than being keyed on: a response with no rate-limit header names no
   * bucket, so a subject has exactly one ceiling for its calls to charge.
   */
  async declare(
    subject: QuotaSubjectRef,
    bucket: string,
    input: ApiBudgetInput,
  ): Promise<ApiBudgetPublic> {
    assertDeclarable(input);
    const row = await this.prisma.apiBudget.upsert({
      where: { subjectKind_subjectId: { subjectKind: subject.kind, subjectId: subject.id } },
      create: {
        subjectKind: subject.kind,
        subjectId: subject.id,
        bucket,
        limit: input.limit,
        windowSec: input.windowSec,
      },
      update: { bucket, limit: input.limit, windowSec: input.windowSec },
    });
    this.cache.set(subjectKey(subject), toBudget(row));
    return toPublic(row);
  }

  /**
   * Declares the ceiling of a source, whose platform says which bucket its
   * calls are charged to. Resolved here rather than sent by the client: the
   * bucket is a property of the platform, not a choice.
   */
  async declareForSource(sourceId: string, input: ApiBudgetInput): Promise<ApiBudgetPublic> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { kind: true },
    });
    if (!source) {
      throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id: sourceId });
    }
    const bucket = QUOTA_BUCKET_BY_KIND[source.kind as keyof typeof QUOTA_BUCKET_BY_KIND];
    return this.declare({ kind: 'source', id: sourceId }, bucket, input);
  }

  /** Drops a declaration. Idempotent: withdrawing nothing is not an error. */
  async forget(subject: QuotaSubjectRef): Promise<void> {
    this.cache.delete(subjectKey(subject));
    await this.prisma.apiBudget.deleteMany({
      where: { subjectKind: subject.kind, subjectId: subject.id },
    });
  }

  /** Rebuilds the cache from the table. */
  private async reload(): Promise<void> {
    const rows = await this.prisma.apiBudget.findMany();
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(subjectKey({ kind: row.subjectKind, id: row.subjectId }), toBudget(row));
    }
  }
}

interface BudgetRow {
  subjectKind: string;
  subjectId: string;
  bucket: string;
  limit: number;
  windowSec: number;
  updatedAt: Date;
}

function toBudget(row: BudgetRow): DeclaredBudget {
  return { bucket: row.bucket, limit: row.limit, windowSec: row.windowSec };
}

function toPublic(row: BudgetRow): ApiBudgetPublic {
  return {
    subjectKind: row.subjectKind as ApiBudgetPublic['subjectKind'],
    subjectId: row.subjectId,
    bucket: row.bucket,
    limit: row.limit,
    windowSec: row.windowSec,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A budget that meters nothing useful is refused rather than stored: a window
 * of a second, or a ceiling of zero, would report a source as spent from its
 * first call and stop the optional work for good.
 */
function assertDeclarable(input: ApiBudgetInput): void {
  const valid =
    Number.isInteger(input.limit) &&
    input.limit >= QUOTA_LIMIT_MIN &&
    Number.isInteger(input.windowSec) &&
    input.windowSec >= QUOTA_WINDOW_SEC_MIN &&
    input.windowSec <= QUOTA_WINDOW_SEC_MAX;
  if (!valid) {
    throw new CodedException('errors.quota.invalidBudget', HttpStatus.BAD_REQUEST, {
      limitMin: QUOTA_LIMIT_MIN,
      windowMin: QUOTA_WINDOW_SEC_MIN,
      windowMax: QUOTA_WINDOW_SEC_MAX,
    });
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
