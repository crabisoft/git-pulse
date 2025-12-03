import { Injectable, HttpStatus } from '@nestjs/common';
import type { LlmKind } from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import type { LlmProvider } from './llm-provider.interface';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GoogleProvider } from './providers/google.provider';
import { MistralProvider, OpenAiProvider } from './providers/openai.provider';

/** Kind → implementation. Adding a vendor is adding a row here and nothing else. */
@Injectable()
export class LlmFactory {
  private readonly byKind: Map<LlmKind, LlmProvider>;

  constructor(
    anthropic: AnthropicProvider,
    openai: OpenAiProvider,
    google: GoogleProvider,
    mistral: MistralProvider,
  ) {
    this.byKind = new Map(
      [anthropic, openai, google, mistral].map((provider) => [provider.kind, provider]),
    );
  }

  for(kind: LlmKind): LlmProvider {
    const provider = this.byKind.get(kind);
    if (!provider) {
      throw new CodedException('errors.llm.unsupportedKind', HttpStatus.BAD_REQUEST, { kind });
    }
    return provider;
  }
}
