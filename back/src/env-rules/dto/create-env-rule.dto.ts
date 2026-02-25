import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { EnvRuleKind, RuleTarget } from '@repo/shared';
import { RULE_TARGETS } from './rule-target';
import { IsAttributeMap } from './attribute-map';

export class CreateEnvRuleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  pattern!: string;

  @IsEnum(['simple', 'meta'] as const)
  kind!: EnvRuleKind;

  /** Defaults to `environment` so existing clients keep working. */
  @IsOptional()
  @IsEnum(RULE_TARGETS)
  target?: RuleTarget;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  /** Forced on a match, for what the name carries nothing to capture. */
  @IsOptional()
  @IsAttributeMap()
  attributes?: Record<string, string>;

  /** Confines the rule to the repos this matches. Omitted or empty: all of them. */
  @IsOptional()
  @IsString()
  repo?: string;
}
