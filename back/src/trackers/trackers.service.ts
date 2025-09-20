import { Injectable, HttpStatus } from '@nestjs/common';
import type { Page, TrackerKind, TrackerPublic } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import type { CreateTrackerDto } from './dto/create-tracker.dto';
import type { UpdateTrackerDto } from './dto/update-tracker.dto';

/**
 * Row shape shared by every read below. Bindings come along for display, but a
 * tracker never writes them: attaching happens from the source, where "what
 * does this source use" is the question actually being answered.
 */
const WITH_SOURCES = { sources: { select: { sourceId: true, incidents: true } } } as const;

@Injectable()
export class TrackersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTrackerDto): Promise<TrackerPublic> {
    const tracker = await this.prisma.tracker.create({
      data: {
        name: dto.name,
        slug: await this.uniqueSlug(dto.name),
        kind: dto.kind,
        baseUrl: dto.baseUrl,
        urlTemplate: dto.urlTemplate ?? null,
      },
      include: WITH_SOURCES,
    });
    return toPublic(tracker);
  }

  async findAll(window: PageWindow): Promise<Page<TrackerPublic>> {
    const [trackers, total] = await this.prisma.$transaction([
      this.prisma.tracker.findMany({
        orderBy: { createdAt: 'asc' },
        skip: window.offset,
        take: window.limit,
        include: WITH_SOURCES,
      }),
      this.prisma.tracker.count(),
    ]);
    return toPage(trackers.map(toPublic), total, window);
  }

  /** Trackers attached to a source — what a ticket rule may point at. */
  async findBySource(sourceId: string): Promise<TrackerPublic[]> {
    const trackers = await this.prisma.tracker.findMany({
      where: { sources: { some: { sourceId } } },
      orderBy: { createdAt: 'asc' },
      include: WITH_SOURCES,
    });
    return trackers.map(toPublic);
  }

  /**
   * The tracker a source's incidents are read from, if any. Null means none —
   * and then nothing is collected, whatever `failureSource` says.
   */
  async incidentTrackerFor(sourceId: string): Promise<TrackerPublic | null> {
    const tracker = await this.prisma.tracker.findFirst({
      where: { sources: { some: { sourceId, incidents: true } } },
      include: WITH_SOURCES,
    });
    return tracker ? toPublic(tracker) : null;
  }

  async update(id: string, dto: UpdateTrackerDto): Promise<TrackerPublic> {
    const current = await this.prisma.tracker.findUnique({ where: { id } });
    if (!current) throw new CodedException('errors.tracker.notFound', HttpStatus.NOT_FOUND, { id });

    const renamed = dto.name !== undefined && dto.name !== current.name;
    const tracker = await this.prisma.tracker.update({
      where: { id },
      data: {
        name: dto.name,
        // The slug mirrors the name, exactly like a source's.
        slug: renamed ? await this.uniqueSlug(dto.name!, id) : undefined,
        kind: dto.kind,
        baseUrl: dto.baseUrl,
        urlTemplate: dto.urlTemplate,
      },
      include: WITH_SOURCES,
    });
    return toPublic(tracker);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.tracker.delete({ where: { id } }).catch(() => {
      throw new CodedException('errors.tracker.notFound', HttpStatus.NOT_FOUND, { id });
    });
  }

  /** Same scheme as sources: names are not unique, slugs are. */
  private async uniqueSlug(name: string, excludeId?: string): Promise<string> {
    const base = slugify(name);
    const siblings = await this.prisma.tracker.findMany({
      where: { slug: { startsWith: base }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { slug: true },
    });
    const taken = new Set(siblings.map((t) => t.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i += 1) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tracker'
  );
}

function toPublic(t: {
  id: string;
  name: string;
  slug: string;
  kind: string;
  baseUrl: string;
  urlTemplate: string | null;
  createdAt: Date;
  updatedAt: Date;
  sources: Array<{ sourceId: string; incidents: boolean }>;
}): TrackerPublic {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    kind: t.kind as TrackerKind,
    baseUrl: t.baseUrl,
    urlTemplate: t.urlTemplate,
    sources: t.sources,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
