import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  EnvUrlMode,
  EnvUrlRulePublic,
  ManualEnvironmentPublic,
  Page,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import type { EnvUrlRuleLike, ManualEnvironmentLike } from './env-url';

import type { CreateEnvUrlRuleDto } from './dto/create-env-url-rule.dto';
import type { UpdateEnvUrlRuleDto } from './dto/update-env-url-rule.dto';
import type { CreateManualEnvironmentDto } from './dto/create-manual-environment.dto';
import type { UpdateManualEnvironmentDto } from './dto/update-manual-environment.dto';

/**
 * Everything a source knows about where its environments answer, read in one
 * go.
 *
 * Read once per listing rather than per deployment: a window holds hundreds of
 * deployments over a handful of environments, and they are all addressed by the
 * same handful of rules.
 */
export interface EnvAddressBook {
  rules: EnvUrlRuleLike[];
  declared: ManualEnvironmentLike[];
}

/** A declared environment as the rest of the app consumes it. */
export interface DeclaredEnvironment {
  /** Empty when it belongs to no repo. */
  repo: string;
  environment: string;
  url: string | null;
  attributes: Record<string, string>;
}

@Injectable()
export class EnvUrlsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Rules ──────────────────────────────────────────────────────────

  async createRule(dto: CreateEnvUrlRuleDto): Promise<EnvUrlRulePublic> {
    assertWritableRule(dto);
    const rule = await this.prisma.envUrlRule.create({
      data: {
        name: dto.name,
        pattern: dto.pattern,
        // An empty string would confine the rule to nothing; it means no repo.
        repo: dto.repo || null,
        urlTemplate: dto.urlTemplate,
        mode: dto.mode ?? 'fill',
        priority: dto.priority ?? 100,
      },
    });
    return toRulePublic(rule);
  }

  /** The whole catalogue — rules belong to no source. */
  async findRules(window: PageWindow): Promise<Page<EnvUrlRulePublic>> {
    const [rules, total] = await this.prisma.$transaction([
      this.prisma.envUrlRule.findMany({
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.envUrlRule.count(),
    ]);
    return toPage(rules.map(toRulePublic), total, window);
  }

  async updateRule(id: string, dto: UpdateEnvUrlRuleDto): Promise<EnvUrlRulePublic> {
    assertWritableRule(dto);
    const rule = await this.prisma.envUrlRule
      .update({
        where: { id },
        // Undefined keys are ignored by Prisma, so the stored value is kept.
        data: {
          name: dto.name,
          pattern: dto.pattern,
          repo: dto.repo === undefined ? undefined : dto.repo || null,
          urlTemplate: dto.urlTemplate,
          mode: dto.mode,
          priority: dto.priority,
        },
      })
      .catch(() => {
        throw new CodedException('errors.envUrlRule.notFound', HttpStatus.NOT_FOUND, { id });
      });
    return toRulePublic(rule);
  }

  async removeRule(id: string): Promise<void> {
    await this.prisma.envUrlRule.delete({ where: { id } }).catch(() => {
      throw new CodedException('errors.envUrlRule.notFound', HttpStatus.NOT_FOUND, { id });
    });
  }

  // ── Declared environments ──────────────────────────────────────────

  async createEnvironment(
    sourceId: string,
    dto: CreateManualEnvironmentDto,
  ): Promise<ManualEnvironmentPublic> {
    assertDeclarableUrl(dto.url);
    const environment = await this.prisma.manualEnvironment
      .create({
        data: {
          sourceId,
          repo: dto.repo ?? '',
          environment: dto.environment,
          url: dto.url || null,
          attributes: dto.attributes ?? {},
          mode: dto.mode ?? 'fill',
        },
      })
      .catch(() => {
        // The unique index is the only thing that can fail here, and what it
        // says is worth passing on: this environment is already declared, so
        // the answer is to edit that one rather than add a second.
        throw new CodedException('errors.manualEnvironment.duplicate', HttpStatus.CONFLICT, {
          repo: dto.repo ?? '',
          environment: dto.environment,
        });
      });
    return toEnvironmentPublic(environment);
  }

  async findEnvironments(
    sourceId: string,
    window: PageWindow,
  ): Promise<Page<ManualEnvironmentPublic>> {
    const where = { sourceId };
    const [environments, total] = await this.prisma.$transaction([
      this.prisma.manualEnvironment.findMany({
        where,
        orderBy: [{ repo: 'asc' }, { environment: 'asc' }],
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.manualEnvironment.count({ where }),
    ]);
    return toPage(environments.map(toEnvironmentPublic), total, window);
  }

  async updateEnvironment(
    id: string,
    dto: UpdateManualEnvironmentDto,
  ): Promise<ManualEnvironmentPublic> {
    assertDeclarableUrl(dto.url);
    const environment = await this.prisma.manualEnvironment
      .update({
        where: { id },
        data: {
          repo: dto.repo,
          environment: dto.environment,
          // An empty string withdraws the address; undefined keeps the stored
          // one. The two are told apart here and nowhere else.
          url: dto.url === undefined ? undefined : dto.url || null,
          attributes: dto.attributes,
          mode: dto.mode,
        },
      })
      .catch(() => {
        throw new CodedException('errors.manualEnvironment.notFound', HttpStatus.NOT_FOUND, { id });
      });
    return toEnvironmentPublic(environment);
  }

  async removeEnvironment(id: string): Promise<void> {
    await this.prisma.manualEnvironment.delete({ where: { id } }).catch(() => {
      throw new CodedException('errors.manualEnvironment.notFound', HttpStatus.NOT_FOUND, { id });
    });
  }

  // ── What the rest of the app reads ─────────────────────────────────

  /**
   * The rules a source opted into and the environments it declared, together.
   *
   * Together because every caller needs both: an address is decided by the two
   * of them, and reading one without the other would answer half the question.
   */
  async addressBook(sourceId: string): Promise<EnvAddressBook> {
    const [rules, declared] = await Promise.all([
      this.prisma.envUrlRule.findMany({
        // Only what this source selected: the catalogue is shared, the
        // selection is not — exactly as with the classification rules.
        where: { sources: { some: { sourceId } } },
        orderBy: { priority: 'asc' },
      }),
      this.prisma.manualEnvironment.findMany({ where: { sourceId } }),
    ]);
    return {
      rules: rules.map((rule) => ({
        name: rule.name,
        pattern: rule.pattern,
        repo: rule.repo,
        urlTemplate: rule.urlTemplate,
        mode: rule.mode as EnvUrlMode,
        priority: rule.priority,
      })),
      declared: declared.map((entry) => ({
        repo: entry.repo,
        environment: entry.environment,
        url: entry.url,
        mode: entry.mode as EnvUrlMode,
      })),
    };
  }

  /**
   * The environments a source declared, as the dashboard and the probes read
   * them — an environment nothing deploys to still exists, and is precisely the
   * one somebody went to the trouble of writing down.
   */
  async declaredFor(sourceId: string): Promise<DeclaredEnvironment[]> {
    const declared = await this.prisma.manualEnvironment.findMany({
      where: { sourceId },
      orderBy: [{ repo: 'asc' }, { environment: 'asc' }],
    });
    return declared.map((entry) => ({
      repo: entry.repo,
      environment: entry.environment,
      url: entry.url,
      attributes: toAttributes(entry.attributes),
    }));
  }
}

/**
 * What a rule has to satisfy to be worth saving.
 *
 * Both checks refuse a rule that would otherwise be stored, applied to every
 * listing, and quietly produce nothing — the failure mode a rule engine has to
 * catch at the door, since an address that never appears looks exactly like a
 * platform that never published one.
 */
function assertWritableRule(dto: {
  pattern?: string;
  repo?: string;
  urlTemplate?: string;
}): void {
  if (dto.pattern !== undefined) assertValidPattern(dto.pattern);
  if (dto.repo) assertValidPattern(dto.repo);
  if (dto.urlTemplate !== undefined && !addressable(dto.urlTemplate)) {
    throw new CodedException('errors.envUrlRule.urlNotAddressable', HttpStatus.BAD_REQUEST, {
      urlTemplate: dto.urlTemplate,
    });
  }
}

/**
 * A declared address is held to what a rule's template is held to.
 *
 * It is checked here rather than left to the reader because it ends up in an
 * `href`: an address stated by hand travels to the deployment list, the
 * changelog page and the boards as a link, and `javascript:` in that position
 * is a script running as whoever clicked it. The rules cannot produce one — a
 * template is refused unless it opens on http(s) — and a declaration must not
 * be the way in that the rules are not.
 *
 * Empty withdraws the address rather than stating a bad one, and undefined
 * leaves the stored one alone: neither is an address to check.
 */
function assertDeclarableUrl(url: string | undefined): void {
  if (!url) return;
  if (!addressable(url)) {
    throw new CodedException('errors.manualEnvironment.urlNotAddressable', HttpStatus.BAD_REQUEST, {
      url,
    });
  }
}

function assertValidPattern(pattern: string): void {
  try {
    new RegExp(pattern);
  } catch {
    throw new CodedException('errors.envUrlRule.invalidPattern', HttpStatus.BAD_REQUEST, {
      pattern,
    });
  }
}

/**
 * Whether a template — or an address stated outright — can be somewhere to go.
 *
 * Absolute http(s) only. Unlike a version rule's template this one cannot open
 * on `{environmentUrl}` — it is what produces that address, so a template built
 * from it would be defining itself. Everything else resolves to a relative
 * string that would reach a browser as a link into our own dashboard.
 */
function addressable(urlTemplate: string): boolean {
  return /^https?:\/\//i.test(urlTemplate);
}

/** Prisma hands the JSON column back as `unknown`; anything else reads as none. */
function toAttributes(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
  ) as Record<string, string>;
}

function toRulePublic(r: {
  id: string;
  name: string;
  pattern: string;
  repo: string | null;
  urlTemplate: string;
  mode: string;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}): EnvUrlRulePublic {
  return {
    id: r.id,
    name: r.name,
    pattern: r.pattern,
    repo: r.repo,
    urlTemplate: r.urlTemplate,
    mode: r.mode as EnvUrlMode,
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toEnvironmentPublic(e: {
  id: string;
  sourceId: string;
  repo: string;
  environment: string;
  url: string | null;
  attributes: unknown;
  mode: string;
  createdAt: Date;
  updatedAt: Date;
}): ManualEnvironmentPublic {
  return {
    id: e.id,
    sourceId: e.sourceId,
    repo: e.repo,
    environment: e.environment,
    url: e.url,
    attributes: toAttributes(e.attributes),
    mode: e.mode as EnvUrlMode,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
