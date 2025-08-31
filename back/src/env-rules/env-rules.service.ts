import { Injectable, HttpStatus } from '@nestjs/common';
import type { ClassifiedEnvironment, EnvRuleKind, EnvRulePublic } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CodedException } from '../common/coded-exception';
import { classifyEnvironment, type EnvRuleLike } from './env-classifier';
import type { CreateEnvRuleDto } from './dto/create-env-rule.dto';
import type { UpdateEnvRuleDto } from './dto/update-env-rule.dto';

@Injectable()
export class EnvRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(sourceId: string, dto: CreateEnvRuleDto): Promise<EnvRulePublic> {
    assertValidPattern(dto.pattern);
    await this.assertSourceExists(sourceId);
    const rule = await this.prisma.envRule.create({
      data: {
        sourceId,
        name: dto.name,
        pattern: dto.pattern,
        kind: dto.kind,
        priority: dto.priority ?? 100,
      },
    });
    return toPublic(rule);
  }

  async findBySource(sourceId: string): Promise<EnvRulePublic[]> {
    const rules = await this.prisma.envRule.findMany({
      where: { sourceId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return rules.map(toPublic);
  }

  async update(id: string, dto: UpdateEnvRuleDto): Promise<EnvRulePublic> {
    if (dto.pattern !== undefined) assertValidPattern(dto.pattern);
    const rule = await this.prisma.envRule
      .update({
        where: { id },
        // Undefined keys are ignored by Prisma, so the stored value is kept.
        data: {
          name: dto.name,
          pattern: dto.pattern,
          kind: dto.kind,
          priority: dto.priority,
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

  /** Classify an environment name against a source's saved rules. */
  async classify(sourceId: string, name: string): Promise<ClassifiedEnvironment> {
    const [classified] = await this.classifyMany(sourceId, [name]);
    return classified;
  }

  /** Same as classify, for several names — the rules are read once. */
  async classifyMany(sourceId: string, names: string[]): Promise<ClassifiedEnvironment[]> {
    const rules = await this.prisma.envRule.findMany({
      where: { sourceId },
      orderBy: { priority: 'asc' },
    });
    const ruleLikes = rules.map(toRuleLike);
    return names.map((name) => classifyEnvironment(name, ruleLikes));
  }

  private async assertSourceExists(sourceId: string): Promise<void> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true },
    });
    if (!source) {
      throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id: sourceId });
    }
  }
}

function assertValidPattern(pattern: string): void {
  try {
    new RegExp(pattern);
  } catch {
    throw new CodedException('errors.envRule.invalidPattern', HttpStatus.BAD_REQUEST, { pattern });
  }
}

function toRuleLike(r: {
  name: string;
  pattern: string;
  kind: string;
  priority: number;
}): EnvRuleLike {
  return { name: r.name, pattern: r.pattern, kind: r.kind as EnvRuleLike['kind'], priority: r.priority };
}

function toPublic(r: {
  id: string;
  sourceId: string;
  name: string;
  pattern: string;
  kind: string;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}): EnvRulePublic {
  return {
    id: r.id,
    sourceId: r.sourceId,
    name: r.name,
    pattern: r.pattern,
    kind: r.kind as EnvRuleKind,
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
