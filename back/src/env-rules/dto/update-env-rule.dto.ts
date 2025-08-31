import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { EnvRuleKind } from '@repo/shared';

/** Partial update of an environment rule — only the supplied keys are persisted. */
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
  @IsInt()
  @Min(0)
  priority?: number;
}
