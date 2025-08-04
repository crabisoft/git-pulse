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

class ScopeDto {
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

  /** Plaintext access secret — encrypted immediately, never returned. */
  @IsString()
  @MinLength(1)
  secret!: string;

  @ValidateNested()
  @Type(() => ScopeDto)
  scope!: ScopeDto;
}
