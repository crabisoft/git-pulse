import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SOURCE_HISTORY_MAX, SOURCE_HISTORY_MIN } from '@repo/shared';
import type { AuthKind, SourceKind, SourceMode } from '@repo/shared';
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

  /** Switching to `stored` fills the store before the dashboard reads from it. */
  @IsOptional()
  @IsEnum(['live', 'stored'] as const)
  mode?: SourceMode;

  /** Turning it off drops the stored secret with it. */
  @IsOptional()
  @IsBoolean()
  webhooksEnabled?: boolean;

  /**
   * Deepening it only takes effect on the next reconciliation, which reads the
   * whole depth — the refresh action is there for whoever will not wait for it.
   * Explicit null goes back to following the reporting window.
   */
  @IsOptional()
  @IsInt()
  @Min(SOURCE_HISTORY_MIN)
  @Max(SOURCE_HISTORY_MAX)
  historyDays?: number | null;

  /** Classification rules that apply here, from the global set. Replaces it. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  envRuleIds?: string[];

  /** Version rules this source's environments are read with. Replaces the set. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  versionRuleIds?: string[];

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
