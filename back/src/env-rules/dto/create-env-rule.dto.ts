import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { EnvRuleKind } from '@repo/shared';

export class CreateEnvRuleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  pattern!: string;

  @IsEnum(['simple', 'meta'] as const)
  kind!: EnvRuleKind;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
