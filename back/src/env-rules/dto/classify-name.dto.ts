import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import type { RuleTarget } from '@repo/shared';
import { RULE_TARGETS } from './rule-target';

/** Classifies one name against a source's saved rules for a given target. */
export class ClassifyNameDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsEnum(RULE_TARGETS)
  target?: RuleTarget;

  /** The repo the name was seen in. Omitted, the repo-scoped rules stand down. */
  @IsOptional()
  @IsString()
  repo?: string;
}
