import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import type { EnvUrlMode } from '@repo/shared';
import { IsAttributeMap } from '../../env-rules/dto/attribute-map';
import { ENV_URL_MODES } from './env-url-mode';

export class CreateManualEnvironmentDto {
  @IsString()
  @MinLength(1)
  environment!: string;

  /** Omitted or empty: the environment belongs to no repo. */
  @IsOptional()
  @IsString()
  repo?: string;

  /** Omitted: the environment is declared without an address, which is allowed. */
  @IsOptional()
  @IsString()
  url?: string;

  /** Forced on it, since no name was matched and nothing classified it. */
  @IsOptional()
  @IsAttributeMap()
  attributes?: Record<string, string>;

  @IsOptional()
  @IsEnum(ENV_URL_MODES)
  mode?: EnvUrlMode;
}
