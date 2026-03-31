import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { VersionAuthKind, VersionFormat } from '@repo/shared';
import { VERSION_AUTH_KINDS, VERSION_FORMATS } from './version-kinds';
import { IsHeaderMap } from './header-map';

export class CreateVersionRuleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  /** Confines the rule to the environments this matches. Omitted: all of them. */
  @IsOptional()
  @IsString()
  environment?: string;

  /** Confines the rule to the repos this matches. Omitted: all of them. */
  @IsOptional()
  @IsString()
  repo?: string;

  @IsString()
  @MinLength(1)
  urlTemplate!: string;

  /** Defaults to `json`, which is what a version endpoint answers with. */
  @IsOptional()
  @IsEnum(VERSION_FORMATS)
  format?: VersionFormat;

  @IsString()
  @MinLength(1)
  template!: string;

  /** Required by `text`, meaningless to the parsed formats. */
  @IsOptional()
  @IsString()
  pattern?: string;

  @IsOptional()
  @IsHeaderMap()
  headers?: Record<string, string>;

  @IsOptional()
  @IsEnum(VERSION_AUTH_KINDS)
  authKind?: VersionAuthKind;

  /** The header the secret goes in, when `authKind` is `header`. */
  @IsOptional()
  @IsString()
  authHeader?: string;

  /**
   * The secret itself, on its way to the encrypted store. It is never handed
   * back: the rule reports whether it holds one, and nothing more.
   */
  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
