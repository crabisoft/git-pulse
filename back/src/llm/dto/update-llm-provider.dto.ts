import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import type { LlmKind } from '@repo/shared';
import { LLM_KIND_VALUES } from './llm-kind';

/**
 * Partial update. An omitted `apiKey` keeps the stored one — the form cannot
 * show it, so it cannot post it back either.
 */
export class UpdateLlmProviderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(LLM_KIND_VALUES)
  kind?: LlmKind;

  @IsOptional()
  @IsString()
  @MinLength(1)
  model?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  apiKey?: string;

  /** Explicit null restores the vendor's public endpoint. */
  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string | null;

  /** True moves the default here; false is refused when it is the only one. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
