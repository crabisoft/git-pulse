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

export class ScopeDto {
  @IsString()
  @MinLength(1)
  owner!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  include?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exclude?: string[];

  /** Omitted keeps the historical reading: everything, unless `include` names some. */
  @IsOptional()
  @IsBoolean()
  trackNewRepos?: boolean;
}

/** GitHub App installation credentials (used when authKind is 'app'). */
export class GitHubAppDto {
  @IsString()
  @MinLength(1)
  appId!: string;

  @IsString()
  @MinLength(1)
  privateKey!: string;

  @IsString()
  @MinLength(1)
  installationId!: string;
}

export class CreateSourceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(['github', 'gitlab'] as const)
  kind!: SourceKind;

  @IsUrl({ require_tld: false })
  baseUrl!: string;

  @IsEnum(['token', 'app'] as const)
  authKind!: AuthKind;

  /** Token for token auth. Encrypted immediately, never returned. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  secret?: string;

  /** GitHub App credentials for app auth. Encrypted as JSON, never returned. */
  @IsOptional()
  @ValidateNested()
  @Type(() => GitHubAppDto)
  app?: GitHubAppDto;

  @ValidateNested()
  @Type(() => ScopeDto)
  scope!: ScopeDto;

  /** Defaults to `live`, the behaviour of every source created before this. */
  @IsOptional()
  @IsEnum(['live', 'stored'] as const)
  mode?: SourceMode;

  /** Only ever true in `stored` mode; refused otherwise. */
  @IsOptional()
  @IsBoolean()
  webhooksEnabled?: boolean;

  /**
   * How far back the ingestion reads, in days. Omitted follows the reporting
   * window — and is read by nothing at all in `live` mode.
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

  /** Trackers this source's pull requests may reference. Replaces the set. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  trackerIds?: string[];

  /** Must be one of `trackerIds`, and of a kind an incident provider exists for. */
  @IsOptional()
  @IsString()
  incidentTrackerId?: string | null;
}
