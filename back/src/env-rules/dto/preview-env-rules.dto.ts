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
import type { EnvRuleKind, RuleTarget } from '@repo/shared';

class RuleInputDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  pattern!: string;

  @IsEnum(['simple', 'meta'] as const)
  kind!: EnvRuleKind;

  /** Ignored — the rules are supplied inline — but accepted so a client can
   * post a saved rule verbatim without stripping the field. */
  @IsOptional()
  @IsEnum(['environment', 'repository'] as const)
  target?: RuleTarget;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

/** Stateless classification preview: a name against a candidate rule set. */
export class PreviewEnvRulesDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleInputDto)
  rules!: RuleInputDto[];
}
