import { Injectable, HttpStatus } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { CodedException } from '../../common/coded-exception';
import type { LlmContext, LlmProvider, LlmRequest } from '../llm-provider.interface';
import { LLM_MAX_TOKENS, asMessage } from './http.util';

/**
 * Anthropic, through the vendor's own SDK — the same choice the Git connectors
 * make with Octokit and gitbeaker. It costs a dependency and buys retries,
 * typed errors and a request shape that follows the API rather than our reading
 * of it at the time of writing.
 */
@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly kind = 'anthropic' as const;

  async complete(ctx: LlmContext, request: LlmRequest): Promise<string> {
    const client = new Anthropic({ apiKey: ctx.apiKey, baseURL: ctx.baseUrl });
    let message: Anthropic.Message;
    try {
      message = await client.messages.create(
        {
          model: ctx.model,
          max_tokens: LLM_MAX_TOKENS,
          system: request.system,
          // Rewriting prose is not a reasoning task. Low effort keeps the
          // thinking short rather than switching it off — recent models accept
          // that only below a certain effort, and answer worse without it.
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: request.prompt }],
        },
        { signal: ctx.signal },
      );
    } catch (e) {
      throw new CodedException('errors.llm.callFailed', HttpStatus.BAD_GATEWAY, {
        reason: asMessage(e),
      });
    }

    // A safety classifier may decline, and says so with a 200 rather than an
    // error. Read as an empty answer, it would look like a model with nothing
    // to say about a release.
    if (message.stop_reason === 'refusal') {
      throw new CodedException('errors.llm.refused', HttpStatus.BAD_GATEWAY);
    }
    return message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
}
