import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller';
import { LlmService } from './llm.service';
import { LlmFactory } from './llm.factory';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GoogleProvider } from './providers/google.provider';
import { MistralProvider, OpenAiProvider } from './providers/openai.provider';

@Module({
  controllers: [LlmController],
  providers: [
    LlmService,
    LlmFactory,
    AnthropicProvider,
    OpenAiProvider,
    GoogleProvider,
    MistralProvider,
  ],
  exports: [LlmService],
})
export class LlmModule {}
