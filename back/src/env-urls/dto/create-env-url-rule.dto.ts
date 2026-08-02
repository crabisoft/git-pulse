import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { EnvUrlMode } from '@repo/shared';
import { ENV_URL_MODES } from './env-url-mode';

export class CreateEnvUrlRuleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  /** Matched against the environment name; its named groups feed the template. */
  @IsString()
  @MinLength(1)
  pattern!: string;

  /** Confines the rule to the repos this matches. Omitted or empty: all of them. */
  @IsOptional()
  @IsString()
  repo?: string;

  @IsString()
  @MinLength(1)
  urlTemplate!: string;

  /** Defaults to `fill`: replacing a published address is the deliberate act. */
  @IsOptional()
  @IsEnum(ENV_URL_MODES)
  mode?: EnvUrlMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
