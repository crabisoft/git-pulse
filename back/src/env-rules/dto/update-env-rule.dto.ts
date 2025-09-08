import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { EnvRuleKind, RuleTarget } from '@repo/shared';

/** Partial update of a classification rule — only the supplied keys are persisted. */
export class UpdateEnvRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  pattern?: string;

  @IsOptional()
  @IsEnum(['simple', 'meta'] as const)
  kind?: EnvRuleKind;

  @IsOptional()
  @IsEnum(['environment', 'repository'] as const)
  target?: RuleTarget;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
