import { Injectable, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  Page,
  VersionAuthKind,
  VersionFormat,
  VersionPreview,
  VersionRulePublic,
} from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsService } from '../crypto/credentials.service';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import { extractVersion, parseBody, templateReadsSomething } from './version-template';
import { probe, type ProbeAuth } from './version-probe';
import type { CreateVersionRuleDto } from './dto/create-version-rule.dto';
import type { UpdateVersionRuleDto } from './dto/update-version-rule.dto';
import type { PreviewVersionRuleDto } from './dto/preview-version-rule.dto';

/** How much of a body the preview hands back — enough to read, not to choke on. */
const PREVIEW_BODY_LIMIT = 20_000;

/** A rule as the prober needs it, secret included. Never leaves the backend. */
export interface ResolvedVersionRule {
  id: string;
  name: string;
  environment: string | null;
  repo: string | null;
  urlTemplate: string;
  format: VersionFormat;
  template: string;
  pattern: string | null;
  headers: Record<string, string>;
  priority: number;
  auth: ProbeAuth;
}

@Injectable()
export class VersionRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
  ) {}

  async create(dto: CreateVersionRuleDto): Promise<VersionRulePublic> {
    assertWritable(dto.format ?? 'json', dto);
    // Minted here rather than by the database, for the same reason a source's
    // is: the secret is keyed by owner and not by relation, so the two writes
    // need an id to agree on before either runs.
    const id = randomUUID();
    const writes: Array<ReturnType<typeof this.credentials.writeOp>> = [];
    if (dto.secret) writes.push(this.credentials.writeOp({ type: 'versionRule', id }, dto.secret));

    const [rule] = await this.prisma.$transaction([
      this.prisma.versionRule.create({
        data: {
          id,
          name: dto.name,
          environment: dto.environment || null,
          repo: dto.repo || null,
          urlTemplate: dto.urlTemplate,
          format: dto.format ?? 'json',
          template: dto.template,
          pattern: dto.pattern || null,
          headers: dto.headers ?? {},
          authKind: dto.authKind ?? 'none',
          authHeader: dto.authHeader || null,
          priority: dto.priority ?? 100,
        },
      }),
      ...writes,
    ]);
    return toPublic(rule, Boolean(dto.secret));
  }

  /** The whole catalogue — rules belong to no source until one selects them. */
  async findAll(window: PageWindow): Promise<Page<VersionRulePublic>> {
    const [rules, total] = await this.prisma.$transaction([
      this.prisma.versionRule.findMany({
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.versionRule.count(),
    ]);
    const held = await this.credentials.heldBy(
      'versionRule',
      rules.map((r) => r.id),
    );
    return toPage(
      rules.map((rule) => toPublic(rule, held.has(rule.id))),
      total,
      window,
    );
  }

  async update(id: string, dto: UpdateVersionRuleDto): Promise<VersionRulePublic> {
    // Read first: whether the patched rule still reads anything is a question
    // about the rule as it will be, not about the fields this request carried.
    const current = await this.prisma.versionRule.findUnique({ where: { id } });
    if (!current) {
      throw new CodedException('errors.versionRule.notFound', HttpStatus.NOT_FOUND, { id });
    }
    const patched = { ...current, ...definedOnly(dto) };
    assertWritable(patched.format as VersionFormat, {
      ...patched,
      environment: patched.environment ?? undefined,
      repo: patched.repo ?? undefined,
      pattern: patched.pattern ?? undefined,
      authHeader: patched.authHeader ?? undefined,
      authKind: patched.authKind as VersionAuthKind,
    });

    const rule = await this.prisma.versionRule.update({
      where: { id },
      // Undefined keys are ignored by Prisma, so a stored value is kept.
      data: {
        name: dto.name,
        environment: dto.environment === undefined ? undefined : dto.environment || null,
        repo: dto.repo === undefined ? undefined : dto.repo || null,
        urlTemplate: dto.urlTemplate,
        format: dto.format,
        template: dto.template,
        pattern: dto.pattern === undefined ? undefined : dto.pattern || null,
        headers: dto.headers,
        authKind: dto.authKind,
        authHeader: dto.authHeader === undefined ? undefined : dto.authHeader || null,
        priority: dto.priority,
      },
    });

    // An omitted secret is one the form never held, and keeps what is stored; an
    // empty one is a deliberate erasure. Dropping authentication altogether
    // takes the secret with it rather than leaving it to be reused by a later
    // edit nobody connects to it.
    if (dto.secret) await this.credentials.set({ type: 'versionRule', id }, dto.secret);
    else if (dto.secret === '' || dto.authKind === 'none') {
      await this.credentials.forget({ type: 'versionRule', id });
    }

    const held = await this.credentials.heldBy('versionRule', [id]);
    return toPublic(rule, held.has(id));
  }

  async remove(id: string): Promise<void> {
    await this.prisma.versionRule.delete({ where: { id } }).catch(() => {
      throw new CodedException('errors.versionRule.notFound', HttpStatus.NOT_FOUND, { id });
    });
    // Keyed by owner rather than by relation, so no cascade reaches it.
    await this.credentials.forget({ type: 'versionRule', id });
  }

  /**
   * Runs a candidate rule against one response, without saving anything.
   *
   * The editor's whole loop: paste, click a field in the tree, watch the
   * version appear. It answers with the tree the resolver walks — the XML
   * already normalised — because a path picked from any other shape would be a
   * path that resolves in the browser and nowhere else.
   */
  async preview(dto: PreviewVersionRuleDto): Promise<VersionPreview> {
    const format = dto.format ?? 'json';
    let body = dto.body ?? '';
    let url: string | null = null;
    let httpStatus: number | null = null;

    if (dto.body === undefined) {
      if (!dto.url) {
        throw new CodedException('errors.versionRule.previewNeedsInput', HttpStatus.BAD_REQUEST);
      }
      url = dto.url;
      const read = await probe({
        url: dto.url,
        headers: dto.headers,
        auth: {
          kind: dto.authKind ?? 'none',
          header: dto.authHeader,
          secret: dto.secret ?? (await this.secretOf(dto.ruleId)),
        },
      });
      httpStatus = read.status;
      body = read.body;
      if (!read.ok) {
        return { tree: null, version: null, reason: read.reason, url, httpStatus, body: '' };
      }
    }

    const parsed = format === 'text' ? null : parseBody(body, format);
    const extracted = extractVersion(body, {
      format,
      template: dto.template,
      pattern: dto.pattern,
    });
    return {
      tree: parsed?.ok ? parsed.value : null,
      version: extracted.ok ? extracted.version : null,
      reason: extracted.ok ? null : extracted.reason,
      url,
      httpStatus,
      body: body.slice(0, PREVIEW_BODY_LIMIT),
    };
  }

  /**
   * The rules a source opted into, secrets resolved, ordered by priority.
   *
   * Read once per probing run: every environment of a source is matched against
   * the same set, and decrypting a secret per environment would be work done
   * again for each.
   */
  async resolvedFor(sourceId: string): Promise<ResolvedVersionRule[]> {
    const rules = await this.prisma.versionRule.findMany({
      // Only what this source selected: the catalogue is shared, the selection
      // is not — exactly as with the classification rules.
      where: { sources: { some: { sourceId } } },
      orderBy: { priority: 'asc' },
    });
    return Promise.all(
      rules.map(async (rule) => ({
        id: rule.id,
        name: rule.name,
        environment: rule.environment,
        repo: rule.repo,
        urlTemplate: rule.urlTemplate,
        format: rule.format as VersionFormat,
        template: rule.template,
        pattern: rule.pattern,
        headers: toHeaders(rule.headers),
        priority: rule.priority,
        auth: {
          kind: rule.authKind as VersionAuthKind,
          header: rule.authHeader,
          secret:
            rule.authKind === 'none'
              ? null
              : await this.credentials.read({ type: 'versionRule', id: rule.id }),
        },
      })),
    );
  }

  private async secretOf(ruleId: string | undefined): Promise<string | null> {
    if (!ruleId) return null;
    return this.credentials.read({ type: 'versionRule', id: ruleId });
  }
}

/**
 * What a rule has to satisfy to be worth saving.
 *
 * Every one of these is a rule that would otherwise be stored, run on a
 * schedule, and quietly report nothing — the failure mode a rule engine has to
 * refuse at the door, since nobody watches a probe that was working last month.
 */
function assertWritable(
  format: VersionFormat,
  dto: {
    environment?: string;
    repo?: string;
    urlTemplate?: string;
    template?: string;
    pattern?: string;
    authKind?: VersionAuthKind;
    authHeader?: string;
  },
): void {
  if (dto.environment) assertValidPattern(dto.environment);
  if (dto.repo) assertValidPattern(dto.repo);

  if (dto.urlTemplate !== undefined && !addressable(dto.urlTemplate)) {
    throw new CodedException('errors.versionRule.urlNotAddressable', HttpStatus.BAD_REQUEST, {
      urlTemplate: dto.urlTemplate,
    });
  }
  if (dto.template !== undefined && !templateReadsSomething(dto.template)) {
    throw new CodedException('errors.versionRule.templateReadsNothing', HttpStatus.BAD_REQUEST, {
      template: dto.template,
    });
  }
  if (format === 'text') {
    if (!dto.pattern) {
      throw new CodedException('errors.versionRule.patternRequired', HttpStatus.BAD_REQUEST);
    }
    assertValidPattern(dto.pattern);
  }
  if (dto.authKind === 'header' && !dto.authHeader) {
    throw new CodedException('errors.versionRule.authHeaderRequired', HttpStatus.BAD_REQUEST);
  }
}

function assertValidPattern(pattern: string): void {
  try {
    new RegExp(pattern);
  } catch {
    throw new CodedException('errors.versionRule.invalidPattern', HttpStatus.BAD_REQUEST, {
      pattern,
    });
  }
}

/**
 * Whether a URL template can produce an address at all.
 *
 * Only the two openings that lead anywhere: an absolute http(s) URL, or the
 * environment address the platform published. Anything else resolves to a
 * relative string the probe would refuse later — later being on a schedule,
 * against an environment, with the reason in a row nobody is reading.
 */
function addressable(urlTemplate: string): boolean {
  return /^https?:\/\//i.test(urlTemplate) || urlTemplate.startsWith('{environmentUrl}');
}

/** The keys a patch actually carried, so an omitted one keeps its stored value. */
function definedOnly<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Prisma hands the JSON column back as `unknown`; anything else reads as none. */
function toHeaders(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
  ) as Record<string, string>;
}

function toPublic(
  r: {
    id: string;
    name: string;
    environment: string | null;
    repo: string | null;
    urlTemplate: string;
    format: string;
    template: string;
    pattern: string | null;
    headers: unknown;
    authKind: string;
    authHeader: string | null;
    priority: number;
    createdAt: Date;
    updatedAt: Date;
  },
  hasSecret: boolean,
): VersionRulePublic {
  return {
    id: r.id,
    name: r.name,
    environment: r.environment,
    repo: r.repo,
    urlTemplate: r.urlTemplate,
    format: r.format as VersionFormat,
    template: r.template,
    pattern: r.pattern,
    headers: toHeaders(r.headers),
    authKind: r.authKind as VersionAuthKind,
    authHeader: r.authHeader,
    hasSecret,
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
