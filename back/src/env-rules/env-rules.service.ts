import { Injectable, HttpStatus } from '@nestjs/common';
import type {
  ClassifiedEnvironment,
  EnvRuleKind,
  EnvRulePublic,
  Page,
  RuleTarget,
} from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import { classifyEnvironment, type EnvRuleLike } from './env-classifier';

import type { CreateEnvRuleDto } from './dto/create-env-rule.dto';
import type { UpdateEnvRuleDto } from './dto/update-env-rule.dto';

/**
 * A name to classify, with the repo it was seen in when the caller knows one.
 * Spelled out at every call site on purpose: whether the repo is known is the
 * whole question a repo-scoped rule asks.
 */
export interface ClassifySubject {
  name: string;
  repo?: string;
}

/**
 * What a classification is filed under. The pair, never the name alone: a rule
 * confined to a repo makes one name classify two ways, so a cache keyed on the
 * name would hand the first repo's answer to every other.
 *
 * Joined on NUL, which neither a repo nor a name carries.
 */
export function subjectKey(subject: ClassifySubject): string {
  return `${subject.repo ?? ''}\u0000${subject.name}`;
}

@Injectable()
export class EnvRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEnvRuleDto): Promise<EnvRulePublic> {
    assertValidPattern(dto.pattern);
    if (dto.repo) assertValidPattern(dto.repo);
    assertContributes(dto.kind, dto.pattern, dto.attributes);
    const rule = await this.prisma.envRule.create({
      data: {
        name: dto.name,
        pattern: dto.pattern,
        kind: dto.kind,
        target: dto.target ?? 'environment',
        priority: dto.priority ?? 100,
        attributes: dto.attributes ?? {},
        // An empty string would confine the rule to nothing; it means no repo.
        repo: dto.repo || null,
      },
    });
    return toPublic(rule);
  }

  /** The whole catalogue for a target — rules belong to no source. */
  async findAll(target: RuleTarget, window: PageWindow): Promise<Page<EnvRulePublic>> {
    const where = { target };
    const [rules, total] = await this.prisma.$transaction([
      this.prisma.envRule.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.envRule.count({ where }),
    ]);
    return toPage(rules.map(toPublic), total, window);
  }

  async update(id: string, dto: UpdateEnvRuleDto): Promise<EnvRulePublic> {
    if (dto.pattern !== undefined) assertValidPattern(dto.pattern);
    if (dto.repo) assertValidPattern(dto.repo);
    // Read first: whether the rule still contributes anything is a question
    // about the patched rule, not about the three keys the request carried.
    const current = await this.prisma.envRule.findUnique({ where: { id } });
    if (!current) {
      throw new CodedException('errors.envRule.notFound', HttpStatus.NOT_FOUND, { id });
    }
    assertContributes(
      dto.kind ?? (current.kind as EnvRuleKind),
      dto.pattern ?? current.pattern,
      dto.attributes ?? toAttributes(current.attributes),
    );
    const rule = await this.prisma.envRule
      .update({
        where: { id },
        // Undefined keys are ignored by Prisma, so the stored value is kept.
        data: {
          name: dto.name,
          pattern: dto.pattern,
          kind: dto.kind,
          target: dto.target,
          priority: dto.priority,
          attributes: dto.attributes,
          repo: dto.repo === undefined ? undefined : dto.repo || null,
        },
      })
      .catch(() => {
        throw new CodedException('errors.envRule.notFound', HttpStatus.NOT_FOUND, { id });
      });
    return toPublic(rule);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.envRule.delete({ where: { id } }).catch(() => {
      throw new CodedException('errors.envRule.notFound', HttpStatus.NOT_FOUND, { id });
    });
  }

  /** Classify one subject against a source's saved rules for the given target. */
  async classify(
    sourceId: string,
    subject: ClassifySubject,
    target: RuleTarget = 'environment',
  ): Promise<ClassifiedEnvironment> {
    const [classified] = await this.classifyMany(sourceId, [subject], target);
    return classified;
  }

  /**
   * Same as classify, for several subjects — the rules are read once. Each
   * subject states its repo or leaves it out, and leaving it out is a claim:
   * the repo is unknown here, so the rules confined to one stay quiet.
   */
  async classifyMany(
    sourceId: string,
    subjects: ClassifySubject[],
    target: RuleTarget = 'environment',
  ): Promise<ClassifiedEnvironment[]> {
    const rules = await this.prisma.envRule.findMany({
      // Only the rules this source opted into: the catalogue is shared, the
      // selection is not.
      where: { target, sources: { some: { sourceId } } },
      orderBy: { priority: 'asc' },
    });
    const ruleLikes = rules.map(toRuleLike);
    return subjects.map((s) => classifyEnvironment(s.name, ruleLikes, { repo: s.repo }));
  }

  /**
   * The same, as a lookup by pair, each distinct pair classified once.
   *
   * What every caller with a list of deployments in hand actually wants: a
   * window holds many deployments per (repo, environment), and they all
   * classify alike.
   */
  async classifyByPair(
    sourceId: string,
    subjects: ClassifySubject[],
    target: RuleTarget = 'environment',
  ): Promise<Map<string, ClassifiedEnvironment>> {
    const distinct = [...new Map(subjects.map((s) => [subjectKey(s), s])).values()];
    const classified = await this.classifyMany(sourceId, distinct, target);
    return new Map(distinct.map((s, i) => [subjectKey(s), classified[i]]));
  }
}

function assertValidPattern(pattern: string): void {
  try {
    new RegExp(pattern);
  } catch {
    throw new CodedException('errors.envRule.invalidPattern', HttpStatus.BAD_REQUEST, { pattern });
  }
}

/**
 * A simple rule that neither captures a named group nor forces an attribute
 * produces nothing however well it matches. Saved silently it looks like a
 * classification that never fires — better refused at the door. Meta rules are
 * exempt: their contribution is their own name.
 */
function assertContributes(
  kind: EnvRuleKind,
  pattern: string,
  attributes: Record<string, string> | undefined,
): void {
  if (kind !== 'simple') return;
  if (Object.keys(attributes ?? {}).length > 0) return;
  if (/\(\?<[A-Za-z_$][\w$]*>/.test(pattern)) return;
  throw new CodedException('errors.envRule.contributesNothing', HttpStatus.BAD_REQUEST, { pattern });
}

/** Prisma hands back the JSON column as `unknown`; anything else reads as none. */
function toAttributes(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
  ) as Record<string, string>;
}

function toRuleLike(r: {
  name: string;
  pattern: string;
  kind: string;
  priority: number;
  attributes: unknown;
  repo: string | null;
}): EnvRuleLike {
  return {
    name: r.name,
    pattern: r.pattern,
    kind: r.kind as EnvRuleLike['kind'],
    priority: r.priority,
    attributes: toAttributes(r.attributes),
    repo: r.repo,
  };
}

function toPublic(r: {
  id: string;
  name: string;
  pattern: string;
  kind: string;
  target: string;
  priority: number;
  attributes: unknown;
  repo: string | null;
  createdAt: Date;
  updatedAt: Date;
}): EnvRulePublic {
  return {
    id: r.id,
    name: r.name,
    pattern: r.pattern,
    kind: r.kind as EnvRuleKind,
    target: r.target as RuleTarget,
    priority: r.priority,
    attributes: toAttributes(r.attributes),
    repo: r.repo,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
