import { Injectable, HttpStatus } from '@nestjs/common';
import {
  TICKET_SOURCES,
  type Page,
  type TicketRef,
  type TicketRulePublic,
  type TicketSource,
  type TrackerKind,
} from '@repo/shared';
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

  async create(dto: CreateTicketRuleDto): Promise<TicketRulePublic> {
    assertValidPattern(dto.pattern);
    const rule = await this.prisma.ticketRule.create({
      data: {
        trackerId: dto.trackerId,
        name: dto.name,
        pattern: dto.pattern,
        ...(dto.sources ? { sources: assertReadsSomething(dto.sources) } : {}),
        priority: dto.priority ?? 100,
      },
    });
    return toPublic(rule);
  }

  /** Every rule; each names the tracker it belongs to. */
  async findAll(window: PageWindow): Promise<Page<TicketRulePublic>> {
    const [rules, total] = await this.prisma.$transaction([
      this.prisma.ticketRule.findMany({
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.ticketRule.count(),
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
          ...(dto.sources ? { sources: assertReadsSomething(dto.sources) } : {}),
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
   * Runs every saved rule over a sample, for the rule tester. Owner and repo are
   * supplied by the caller rather than read from a source: rules belong to no
   * source, and a git-hosted link needs both to resolve.
   */
  async preview(sample: {
    branch?: string;
    title?: string;
    body?: string;
    commit?: string;
    owner?: string;
    repo?: string;
  }): Promise<TicketRef[]> {
    const rules = await this.prisma.ticketRule.findMany({
      orderBy: { priority: 'asc' },
      include: { tracker: true },
    });
    return extractTickets(
      {
        branch: sample.branch,
        title: sample.title,
        body: sample.body,
        commit: sample.commit,
      },
      rules.map(toRuleLike),
      sample.repo ? { owner: sample.owner ?? '', repo: sample.repo } : undefined,
    );
  }

  /**
   * Which texts the rules reaching this source ask to read, merged.
   *
   * Asked before work whose only purpose is to feed the extraction — resolving
   * the pull request a commit came in on, which costs a call per commit. With
   * no rule attached the set is empty and the work is skipped entirely; with
   * rules that read only the commit message, it is skipped just as well.
   */
  async sourcesFor(sourceId: string): Promise<Set<TicketSource>> {
    const rules = await this.prisma.ticketRule.findMany({
      where: { tracker: { sources: { some: { sourceId } } } },
      select: { sources: true },
    });
    return new Set(rules.flatMap((rule) => rule.sources as TicketSource[]));
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
      // A rule reaches a source through its tracker: attaching the tracker is
      // what makes its patterns apply.
      where: { tracker: { sources: { some: { sourceId } } } },
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

/**
 * A rule reading no text is refused rather than stored: it would match nothing,
 * silently, and look exactly like a rule whose pattern is wrong.
 */
function assertReadsSomething(sources: TicketSource[]): TicketSource[] {
  const kept = TICKET_SOURCES.filter((source) => sources.includes(source));
  if (kept.length === 0) {
    throw new CodedException('errors.ticketRule.noSource', HttpStatus.BAD_REQUEST);
  }
  return kept;
}

export function toRuleLike(r: {
  name: string;
  pattern: string;
  sources: string[];
  priority: number;
  tracker: {
    id: string;
    name: string;
    kind: string;
    baseUrl: string;
    urlTemplate: string | null;
  };
}): TicketRuleLike {
  return {
    name: r.name,
    pattern: r.pattern,
    sources: r.sources as TicketSource[],
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
  trackerId: string;
  name: string;
  pattern: string;
  sources: string[];
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}): TicketRulePublic {
  return {
    id: r.id,
    trackerId: r.trackerId,
    name: r.name,
    pattern: r.pattern,
    sources: r.sources as TicketSource[],
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
