import { Injectable } from '@nestjs/common';
import type { LlmContext, LlmProvider, LlmRequest } from '../llm-provider.interface';
import { postJson } from './http.util';

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * Google's generative language API. The model is part of the path rather than
 * of the body, and the key travels in a header of its own — which is why this
 * one cannot share the chat-completions shape the other two use.
 */
@Injectable()
export class GoogleProvider implements LlmProvider {
  readonly kind = 'google' as const;

  async complete(ctx: LlmContext, request: LlmRequest): Promise<string> {
    // The model reaches the URL, so a name with a slash in it would otherwise
    // read as another path segment.
    const model = encodeURIComponent(ctx.model);
    const body = (await postJson(
      `${ctx.baseUrl}/v1beta/models/${model}:generateContent`,
      { 'x-goog-api-key': ctx.apiKey },
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      },
      ctx.signal,
    )) as GenerateContentResponse;

    // One candidate is asked for, but the answer is split into as many parts as
    // the model saw fit — they are one text, not alternatives.
    return (body.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('');
  }
}
