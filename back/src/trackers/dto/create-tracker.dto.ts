import { IsEnum, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import type { TrackerKind } from '@repo/shared';
import { TRACKER_KINDS } from './tracker-kind';

/**
 * A tracker carries no binding: which sources use it is written from the
 * source, and only read back here.
 */
export class CreateTrackerDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(TRACKER_KINDS)
  kind!: TrackerKind;

  @IsUrl({ require_tld: false })
  baseUrl!: string;

  /** Omitted falls back to the link shape derived from `kind`. */
  @IsOptional()
  @IsString()
  urlTemplate?: string | null;
}
