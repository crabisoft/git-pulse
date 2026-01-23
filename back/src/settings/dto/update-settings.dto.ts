import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import {
  DISPLAY_MODES,
  OVERVIEW_DIRECTIONS,
  RELEASE_NOTES_GENERATORS,
  type DisplayMode,
  type FailureSource,
  type OverviewDirection,
  type ReleaseNotesGenerator,
} from '@repo/shared';

/** Partial update — only the supplied keys are persisted. */
export class UpdateSettingsDto {
  @IsOptional()
  @IsInt()
  doraWindowDays?: number;

  @IsOptional()
  @IsInt()
  stalePrHours?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  collectCron?: string;

  /** Cron pattern of the store's purge — its own schedule, not the collection's. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  pruneCron?: string;

  /** Days kept beyond each source's ingestion depth before a row is swept. */
  @IsOptional()
  @IsInt()
  retentionMarginDays?: number;

  @IsOptional()
  @IsInt()
  pageSize?: number;

  /** False puts the whole application behind a sign-in, settings included. */
  @IsOptional()
  @IsBoolean()
  publicDashboard?: boolean;

  @IsOptional()
  @IsEnum(['pipelines', 'incidents', 'both'] as const)
  failureSource?: FailureSource;

  /** Stored comma-separated, so a label may not contain a comma. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  incidentLabels?: string[];

  /** Percent of a rate-limit budget the optional calls may not dip into. */
  @IsOptional()
  @IsInt()
  quotaReservePct?: number;

  /** Which engine renders the Markdown of a release note. */
  @IsOptional()
  @IsEnum(RELEASE_NOTES_GENERATORS)
  releaseNotesGenerator?: ReleaseNotesGenerator;

  /** Which overview the install opens on, for whoever has not chosen. */
  @IsOptional()
  @IsEnum(OVERVIEW_DIRECTIONS)
  overviewDirection?: OverviewDirection;

  /** Light or dark for whoever has not chosen. */
  @IsOptional()
  @IsEnum(DISPLAY_MODES)
  displayMode?: DisplayMode;
}
