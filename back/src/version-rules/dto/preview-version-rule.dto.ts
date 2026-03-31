import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import type { VersionAuthKind, VersionFormat } from '@repo/shared';
import { VERSION_AUTH_KINDS, VERSION_FORMATS } from './version-kinds';
import { IsHeaderMap } from './header-map';

/**
 * Trying a rule out before saving it.
 *
 * Two ways in, and the default is the one that touches no network: a body
 * pasted from wherever its author already had it open. Writing a template is
 * half a dozen attempts, and none of them needs a request — nor should make
 * one, this being the route that would otherwise read an address on behalf of
 * whoever types it.
 */
export class PreviewVersionRuleDto {
  /** The response, as pasted. Takes precedence: nothing is fetched when it is here. */
  @IsOptional()
  @IsString()
  body?: string;

  /** Read only when no body was given. */
  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsEnum(VERSION_FORMATS)
  format?: VersionFormat;

  @IsString()
  @MinLength(1)
  template!: string;

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

  /** Used for this request and never stored — a rule being written has none yet. */
  @IsOptional()
  @IsString()
  secret?: string;

  /**
   * A saved rule whose stored secret to reuse. What lets an existing rule be
   * re-tried without its secret making the round trip to the browser and back.
   */
  @IsOptional()
  @IsUUID()
  ruleId?: string;
}
