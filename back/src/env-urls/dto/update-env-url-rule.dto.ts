import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { EnvUrlMode } from '@repo/shared';
import { ENV_URL_MODES } from './env-url-mode';

/** Partial update of an address rule — only the supplied keys are persisted. */
export class UpdateEnvUrlRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  pattern?: string;

  /** An empty string releases the rule back to every repo. */
  @IsOptional()
  @IsString()
  repo?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  urlTemplate?: string;

  @IsOptional()
  @IsEnum(ENV_URL_MODES)
  mode?: EnvUrlMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
