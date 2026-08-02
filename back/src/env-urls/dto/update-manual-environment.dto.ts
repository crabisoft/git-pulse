import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import type { EnvUrlMode } from '@repo/shared';
import { IsAttributeMap } from '../../env-rules/dto/attribute-map';
import { ENV_URL_MODES } from './env-url-mode';

/** Partial update of a declared environment — only the supplied keys are persisted. */
export class UpdateManualEnvironmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  environment?: string;

  /** An empty string detaches it from its repo. */
  @IsOptional()
  @IsString()
  repo?: string;

  /** An empty string withdraws the address without withdrawing the environment. */
  @IsOptional()
  @IsString()
  url?: string;

  /** Supplied in full — an empty map clears the forced attributes. */
  @IsOptional()
  @IsAttributeMap()
  attributes?: Record<string, string>;

  @IsOptional()
  @IsEnum(ENV_URL_MODES)
  mode?: EnvUrlMode;
}
