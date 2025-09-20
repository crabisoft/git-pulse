import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AuthKind, SourceKind } from '@repo/shared';
import { GitHubAppDto, ScopeDto } from './create-source.dto';

/**
 * Partial update of a source. Every field is optional; the credential is only
 * re-encrypted when a new secret (or app payload) is supplied.
 */
export class UpdateSourceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(['github', 'gitlab'] as const)
  kind?: SourceKind;

  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string;

  @IsOptional()
  @IsEnum(['token', 'app'] as const)
  authKind?: AuthKind;

  @IsOptional()
  @IsString()
  @MinLength(1)
  secret?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GitHubAppDto)
  app?: GitHubAppDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScopeDto)
  scope?: ScopeDto;

  /** Supplied means "these are the trackers now" — the set is replaced. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  trackerIds?: string[];

  /** Explicit null stops collecting incidents for this source. */
  @IsOptional()
  @IsString()
  incidentTrackerId?: string | null;
}
