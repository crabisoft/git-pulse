import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import {
  DORA_WINDOW_MAX,
  DORA_WINDOW_MIN,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  type AppSettings,
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
};

const LIMITS = {
  doraWindowDays: { min: DORA_WINDOW_MIN, max: DORA_WINDOW_MAX },
  stalePrHours: { min: 1, max: 8760 },
  pageSize: { min: 1, max: PAGE_LIMIT_MAX },
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
    if (dto.collectCron !== undefined) assertValidCron(dto.collectCron);

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
   * Registers a callback invoked after every update. Lets other modules react
   * to a change (rescheduling the collection, ...) without this service having
   * to depend on them.
   */
  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }
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
