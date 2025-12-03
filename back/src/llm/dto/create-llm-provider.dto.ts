import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import type { LlmKind } from '@repo/shared';
import { LLM_KIND_VALUES } from './llm-kind';

/** Declaring a provider. The key is written here and never read back. */
export class CreateLlmProviderDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(LLM_KIND_VALUES)
  kind!: LlmKind;

  /** As the vendor spells it — free text, since vendors rename models often. */
  @IsString()
  @MinLength(1)
  model!: string;

  @IsString()
  @MinLength(1)
  apiKey!: string;

  /** Omitted falls back to the vendor's public endpoint. */
  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string | null;

  /** Ignored on the first provider, which becomes the default whatever it says. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
