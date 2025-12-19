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
  RELEASE_NOTES_GENERATORS,
  type FailureSource,
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
}
