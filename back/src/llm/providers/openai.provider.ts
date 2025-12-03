import { Injectable } from '@nestjs/common';
import type { LlmContext, LlmProvider, LlmRequest } from '../llm-provider.interface';
import { postJson } from './http.util';

/** Shape both OpenAI and Mistral answer a chat completion with. */
interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/**
 * OpenAI's chat completions. No output ceiling is sent: the parameter that
 * carries one was renamed, and the newer models reject the older name — where
 * omitting it is accepted by every one of them.
 */
@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly kind = 'openai' as const;

  async complete(ctx: LlmContext, request: LlmRequest): Promise<string> {
    return chatCompletion(ctx, request);
  }
}

/** Mistral speaks the same request and answers the same shape. */
@Injectable()
export class MistralProvider implements LlmProvider {
  readonly kind = 'mistral' as const;

  async complete(ctx: LlmContext, request: LlmRequest): Promise<string> {
    return chatCompletion(ctx, request);
  }
}

async function chatCompletion(ctx: LlmContext, request: LlmRequest): Promise<string> {
  const body = (await postJson(
    `${ctx.baseUrl}/v1/chat/completions`,
    { authorization: `Bearer ${ctx.apiKey}` },
    {
      model: ctx.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
    },
    ctx.signal,
  )) as ChatCompletion;
  return body.choices?.[0]?.message?.content ?? '';
}
