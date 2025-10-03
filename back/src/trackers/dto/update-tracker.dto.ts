import { IsEnum, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import type { TrackerKind } from '@repo/shared';
import { TRACKER_KINDS } from './tracker-kind';

/** Partial update — only the supplied keys are persisted. */
export class UpdateTrackerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(TRACKER_KINDS)
  kind?: TrackerKind;

  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string;

  /** Explicit null restores the shape derived from `kind`. */
  @IsOptional()
  @IsString()
  urlTemplate?: string | null;
}
