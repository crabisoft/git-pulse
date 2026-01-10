import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import {
  DORA_WINDOW_MAX,
  DORA_WINDOW_MIN,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  QUOTA_RESERVE_PCT_MAX,
  QUOTA_RESERVE_PCT_MIN,
  DISPLAY_MODES,
  OVERVIEW_DIRECTIONS,
  RELEASE_NOTES_GENERATORS,
  type AppSettings,
  type DisplayMode,
  type FailureSource,
  type OverviewDirection,
  type ReleaseNotesGenerator,
} from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CodedException } from '../common/coded-exception';
import type { UpdateSettingsDto } from './dto/update-settings.dto';

/** Built-in values of a fresh install, until a value is stored. */
const FALLBACKS: AppSettings = {
  doraWindowDays: 30,
  stalePrHours: 72,
  collectCron: '*/15 * * * *',
  pageSize: PAGE_LIMIT_DEFAULT,
  // Open by default: an install that has just been upgraded keeps showing its
  // dashboard to everyone it showed it to yesterday. Closing it is a decision,
  // and it is one click away in the settings.
  publicDashboard: true,
  // Pipelines only: the historical behavior, and the only one that needs no
  // configuration to be correct.
  failureSource: 'pipelines',
  incidentLabels: [],
  // A tenth of the budget: enough to leave the calls that carry the metrics
  // room to finish, small enough that the enrichment runs on any normal day.
  quotaReservePct: 10,
  // The renderer that lists every commit. The other one is better on a history
  // that holds the convention, and nothing here knows whether this one does.
  releaseNotesGenerator: 'builtin',
  // The board: it is the one that reads from across a room, which is where an
  // overview left open all day actually gets read.
  overviewDirection: 'control',
  // Nobody's eyes are guessed at. The operating system already knows whether
  // this desk is a dark one.
  displayMode: 'system',
};

const LIMITS = {
  doraWindowDays: { min: DORA_WINDOW_MIN, max: DORA_WINDOW_MAX },
  stalePrHours: { min: 1, max: 8760 },
  pageSize: { min: 1, max: PAGE_LIMIT_MAX },
  quotaReservePct: { min: QUOTA_RESERVE_PCT_MIN, max: QUOTA_RESERVE_PCT_MAX },
};

type Listener = (settings: AppSettings) => void;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly listeners: Listener[] = [];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Effective settings: stored value, else the built-in fallback. Everything
   * here is editable from the Settings section, so the database is the only
   * source — no environment override.
   */
  async get(): Promise<AppSettings> {
    const rows = await this.prisma.appSetting.findMany();
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    return {
      doraWindowDays: readNumber(stored.get('doraWindowDays'), FALLBACKS.doraWindowDays),
      stalePrHours: readNumber(stored.get('stalePrHours'), FALLBACKS.stalePrHours),
      collectCron: stored.get('collectCron') ?? FALLBACKS.collectCron,
      pageSize: readNumber(stored.get('pageSize'), FALLBACKS.pageSize),
      publicDashboard: readBoolean(stored.get('publicDashboard'), FALLBACKS.publicDashboard),
      failureSource: readFailureSource(stored.get('failureSource')),
      incidentLabels: readList(stored.get('incidentLabels')),
      quotaReservePct: readNumber(stored.get('quotaReservePct'), FALLBACKS.quotaReservePct),
      releaseNotesGenerator: readGenerator(stored.get('releaseNotesGenerator')),
      overviewDirection: readOneOf(
        stored.get('overviewDirection'),
        OVERVIEW_DIRECTIONS,
        FALLBACKS.overviewDirection,
      ),
      displayMode: readOneOf(stored.get('displayMode'), DISPLAY_MODES, FALLBACKS.displayMode),
    };
  }

  /** Default page size of every list route, when the client asks for no limit. */
  async pageSize(): Promise<number> {
    return (await this.get()).pageSize;
  }

  /** Persists the supplied keys and notifies the listeners with the new state. */
  async update(dto: UpdateSettingsDto): Promise<AppSettings> {
    assertInRange('doraWindowDays', dto.doraWindowDays);
    assertInRange('stalePrHours', dto.stalePrHours);
    assertInRange('pageSize', dto.pageSize);
    assertInRange('quotaReservePct', dto.quotaReservePct);
    if (dto.collectCron !== undefined) assertValidCron(dto.collectCron);
    await this.assertIncidentsConfigured(dto);

    const entries = Object.entries(dto).filter(([, value]) => value !== undefined);
    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.appSetting.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        }),
      ),
    );

    const settings = await this.get();
    for (const listener of this.listeners) {
      try {
        listener(settings);
      } catch (e) {
        this.logger.warn(`Listener de réglages en échec : ${asMessage(e)}`);
      }
    }
    return settings;
  }

  /**
   * Incidents without labels would make every issue in the scope a production
   * failure. Checked against the merged state, since an update may set either
   * key on its own.
   */
  private async assertIncidentsConfigured(dto: UpdateSettingsDto): Promise<void> {
    if (dto.failureSource === undefined && dto.incidentLabels === undefined) return;
    const current = await this.get();
    const failureSource = dto.failureSource ?? current.failureSource;
    const labels = dto.incidentLabels ?? current.incidentLabels;
    if (failureSource !== 'pipelines' && labels.length === 0) {
      throw new CodedException('errors.settings.incidentLabelsRequired', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Registers a callback invoked after every update. Lets other modules react
   * to a change (rescheduling the collection, ...) without this service having
   * to depend on them.
   */
  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }
}

/** Comma-separated in storage — `AppSetting.value` is a plain string column. */
function readList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readFailureSource(raw: string | undefined): FailureSource {
  return raw === 'incidents' || raw === 'both' ? raw : FALLBACKS.failureSource;
}

function readGenerator(raw: string | undefined): ReleaseNotesGenerator {
  return RELEASE_NOTES_GENERATORS.find((value) => value === raw) ?? FALLBACKS.releaseNotesGenerator;
}

/**
 * A stored value that has to be one of a closed list. A row left behind by an
 * older version reads as the fallback rather than reaching the front, where it
 * would resolve to no stylesheet at all.
 */
function readOneOf<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((value) => value === raw) ?? fallback;
}

/** `AppSetting.value` is a plain string column, so booleans travel as text. */
function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function readNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return raw !== undefined && Number.isFinite(value) ? value : fallback;
}

function assertInRange(key: keyof typeof LIMITS, value: number | undefined): void {
  if (value === undefined) return;
  const { min, max } = LIMITS[key];
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CodedException('errors.settings.outOfRange', HttpStatus.BAD_REQUEST, {
      key,
      min,
      max,
    });
  }
}

/** Loose 5- or 6-field cron check — BullMQ remains the authority at scheduling time. */
function assertValidCron(pattern: string): void {
  const fields = pattern.trim().split(/\s+/);
  const valid =
    (fields.length === 5 || fields.length === 6) &&
    fields.every((f) => /^[0-9*/,\-?LW#]+$/.test(f));
  if (!valid) {
    throw new CodedException('errors.settings.invalidCron', HttpStatus.BAD_REQUEST, { pattern });
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
