import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { VersionAuthKind, VersionFormat } from '@repo/shared';
import { VERSION_AUTH_KINDS, VERSION_FORMATS } from './version-kinds';
import { IsHeaderMap } from './header-map';

/**
 * Every field optional, and an omitted one keeps its stored value — including
 * the secret, which a form that never received it cannot resend.
 */
export class UpdateVersionRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  repo?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  urlTemplate?: string;

  @IsOptional()
  @IsEnum(VERSION_FORMATS)
  format?: VersionFormat;

  @IsOptional()
  @IsString()
  @MinLength(1)
  template?: string;

  @IsOptional()
  @IsString()
  pattern?: string;

  @IsOptional()
  @IsHeaderMap()
  headers?: Record<string, string>;

  @IsOptional()
  @IsEnum(VERSION_AUTH_KINDS)
  authKind?: VersionAuthKind;

  @IsOptional()
  @IsString()
  authHeader?: string;

  /** Replaces the stored secret. Omitted leaves it alone; empty clears it. */
  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
