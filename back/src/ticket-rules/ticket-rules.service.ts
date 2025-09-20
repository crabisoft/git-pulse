import { Injectable, HttpStatus } from '@nestjs/common';
import type { Page, TicketRef, TicketRulePublic, TrackerKind } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import {
  extractTickets,
  type TicketOrigin,
  type TicketRuleLike,
  type TicketTexts,
} from './ticket-extractor';
import type { CreateTicketRuleDto } from './dto/create-ticket-rule.dto';
import type { UpdateTicketRuleDto } from './dto/update-ticket-rule.dto';

@Injectable()
export class TicketRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(sourceId: string, dto: CreateTicketRuleDto): Promise<TicketRulePublic> {
    assertValidPattern(dto.pattern);
    const rule = await this.prisma.ticketRule.create({
      data: {
        sourceId,
        trackerId: dto.trackerId,
        name: dto.name,
        pattern: dto.pattern,
        priority: dto.priority ?? 100,
      },
    });
    return toPublic(rule);
  }

  async findBySource(sourceId: string, window: PageWindow): Promise<Page<TicketRulePublic>> {
    const [rules, total] = await this.prisma.$transaction([
      this.prisma.ticketRule.findMany({
        where: { sourceId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.ticketRule.count({ where: { sourceId } }),
    ]);
    return toPage(rules.map(toPublic), total, window);
  }

  async update(id: string, dto: UpdateTicketRuleDto): Promise<TicketRulePublic> {
    if (dto.pattern !== undefined) assertValidPattern(dto.pattern);
    const rule = await this.prisma.ticketRule
      .update({
        where: { id },
        data: {
          trackerId: dto.trackerId,
          name: dto.name,
          pattern: dto.pattern,
          priority: dto.priority,
        },
      })
      .catch(() => {
        throw new CodedException('errors.ticketRule.notFound', HttpStatus.NOT_FOUND, { id });
      });
    return toPublic(rule);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.ticketRule.delete({ where: { id } }).catch(() => {
      throw new CodedException('errors.ticketRule.notFound', HttpStatus.NOT_FOUND, { id });
    });
  }

  /**
   * Runs the saved rules over a sample, for the rule tester. The owner comes
   * from the source's own scope, so a preview links exactly like the real thing.
   */
  async preview(
    sourceId: string,
    sample: { branch?: string; title?: string; repo?: string },
  ): Promise<TicketRef[]> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { scope: true },
    });
    if (!source) {
      throw new CodedException('errors.source.notFound', HttpStatus.NOT_FOUND, { id: sourceId });
    }
    const owner = (source.scope as { owner?: string } | null)?.owner ?? '';
    const [refs] = await this.extractMany(
      sourceId,
      [{ branch: sample.branch ?? '', title: sample.title ?? '' }],
      sample.repo ? [{ owner, repo: sample.repo }] : [],
    );
    return refs ?? [];
  }

  /**
   * Extracts the references of several PRs at once — the rules and their
   * trackers are read a single time, since every PR of a source is matched
   * against the same set.
   *
   * `origins` is positional with `texts`: a git-hosted tracker needs the repo a
   * PR belongs to before it can build a link.
   */
  async extractMany(
    sourceId: string,
    texts: TicketTexts[],
    origins: TicketOrigin[] = [],
  ): Promise<TicketRef[][]> {
    if (texts.length === 0) return [];
    const rules = await this.prisma.ticketRule.findMany({
      where: { sourceId },
      orderBy: { priority: 'asc' },
      include: { tracker: true },
    });
    const ruleLikes = rules.map(toRuleLike);
    return texts.map((t, i) => extractTickets(t, ruleLikes, origins[i]));
  }
}

/** Rejected at write time so a broken pattern never reaches the extractor. */
function assertValidPattern(pattern: string): void {
  try {
    new RegExp(pattern, 'g');
  } catch {
    throw new CodedException('errors.ticketRule.invalidPattern', HttpStatus.BAD_REQUEST, {
      pattern,
    });
  }
}

export function toRuleLike(r: {
  name: string;
  pattern: string;
  priority: number;
  tracker: { id: string; name: string; kind: string; baseUrl: string; urlTemplate: string | null };
}): TicketRuleLike {
  return {
    name: r.name,
    pattern: r.pattern,
    priority: r.priority,
    tracker: {
      id: r.tracker.id,
      name: r.tracker.name,
      kind: r.tracker.kind as TrackerKind,
      baseUrl: r.tracker.baseUrl,
      urlTemplate: r.tracker.urlTemplate,
    },
  };
}

function toPublic(r: {
  id: string;
  sourceId: string;
  trackerId: string;
  name: string;
  pattern: string;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}): TicketRulePublic {
  return {
    id: r.id,
    sourceId: r.sourceId,
    trackerId: r.trackerId,
    name: r.name,
    pattern: r.pattern,
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
