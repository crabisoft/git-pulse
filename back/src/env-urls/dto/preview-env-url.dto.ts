import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { EnvUrlMode } from '@repo/shared';
import { IsAttributeMap } from '../../env-rules/dto/attribute-map';
import { ENV_URL_MODES } from './env-url-mode';

class EnvUrlRuleInputDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  pattern!: string;

  @IsOptional()
  @IsString()
  repo?: string;

  @IsString()
  @MinLength(1)
  urlTemplate!: string;

  @IsOptional()
  @IsEnum(ENV_URL_MODES)
  mode?: EnvUrlMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

/** Stateless address preview: one environment against a candidate rule set. */
export class PreviewEnvUrlDto {
  @IsString()
  @MinLength(1)
  environment!: string;

  /** The repo to try it in — the rules confined to one need it. */
  @IsOptional()
  @IsString()
  repo?: string;

  @IsOptional()
  @IsString()
  ref?: string;

  /**
   * What the platform would have published. Supplied because it decides the
   * answer as much as the rules do: `fill` stands down in its presence, which
   * is the part of a rule people get wrong.
   */
  @IsOptional()
  @IsString()
  environmentUrl?: string;

  /** Attributes the classification would have contributed, as `{attr.*}`. */
  @IsOptional()
  @IsAttributeMap()
  attributes?: Record<string, string>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnvUrlRuleInputDto)
  rules!: EnvUrlRuleInputDto[];
}
