import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { EnvRuleKind, RuleTarget } from '@repo/shared';

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
  @IsEnum(['environment', 'repository'] as const)
  target?: RuleTarget;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
