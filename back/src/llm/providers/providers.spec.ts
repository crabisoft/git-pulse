import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodedException } from '../../common/coded-exception';
import type { LlmContext, LlmRequest } from '../llm-provider.interface';
import { AnthropicProvider } from './anthropic.provider';
import { GoogleProvider } from './google.provider';
import { MistralProvider, OpenAiProvider } from './openai.provider';

/**
 * These run the real providers against a stubbed transport, for the same reason
 * the quota metering seams do: no type check covers a request shape, and a
 * vendor that moves one announces it to nobody. The only symptom in production
 * would be a rewriting that stopped working.
 */

const REQUEST: LlmRequest = { system: 'Be brief.', prompt: 'Rewrite these notes.' };

function context(over: Partial<LlmContext> = {}): LlmContext {
  return { kind: 'openai', model: 'm-1', baseUrl: 'https://api.example', apiKey: 'k', ...over };
}

/** Captures the one call made, and answers with `body`. */
function stubFetch(body: unknown, init: { ok?: boolean; text?: string } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} });
    return {
      ok: init.ok ?? true,
      status: init.ok === false ? 401 : 200,
      json: async () => body,
      text: async () => init.text ?? '',
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function sentBody(calls: Array<{ init: RequestInit }>): Record<string, unknown> {
  return JSON.parse(String(calls[0].init.body));
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI-shaped providers', () => {
  it('posts a chat completion and reads the message back', async () => {
    const calls = stubFetch({ choices: [{ message: { content: 'rewritten' } }] });
    const text = await new OpenAiProvider().complete(context(), REQUEST);

    expect(text).toBe('rewritten');
    expect(calls[0].url).toBe('https://api.example/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(sentBody(calls)).toEqual({
      model: 'm-1',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Rewrite these notes.' },
      ],
    });
  });

  it('sends no output ceiling — the parameter carrying one was renamed', async () => {
    const calls = stubFetch({ choices: [{ message: { content: 'x' } }] });
    await new OpenAiProvider().complete(context(), REQUEST);
    expect(sentBody(calls)).not.toHaveProperty('max_tokens');
  });

  it('reads Mistral the same way, on its own base URL', async () => {
    const calls = stubFetch({ choices: [{ message: { content: 'rewritten' } }] });
    const text = await new MistralProvider().complete(
      context({ kind: 'mistral', baseUrl: 'https://api.mistral.ai' }),
      REQUEST,
    );
    expect(text).toBe('rewritten');
    expect(calls[0].url).toBe('https://api.mistral.ai/v1/chat/completions');
  });

  it('answers empty rather than throwing when the vendor returns no choice', async () => {
    // An empty answer is caught one level up, where it reads as "the model said
    // nothing" instead of a crash on an undefined field.
    stubFetch({ choices: [] });
    expect(await new OpenAiProvider().complete(context(), REQUEST)).toBe('');
  });
});

describe('Google provider', () => {
  it('puts the model in the path and the key in its own header', async () => {
    const calls = stubFetch({ candidates: [{ content: { parts: [{ text: 'rewritten' }] } }] });
    const text = await new GoogleProvider().complete(
      context({ kind: 'google', model: 'g-1' }),
      REQUEST,
    );

    expect(text).toBe('rewritten');
    expect(calls[0].url).toBe('https://api.example/v1beta/models/g-1:generateContent');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(sentBody(calls)).toEqual({
      systemInstruction: { parts: [{ text: 'Be brief.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Rewrite these notes.' }] }],
    });
  });

  it('joins the parts of one answer rather than taking the first', async () => {
    stubFetch({ candidates: [{ content: { parts: [{ text: '## Rel' }, { text: 'ease' }] } }] });
    expect(await new GoogleProvider().complete(context({ kind: 'google' }), REQUEST)).toBe(
      '## Release',
    );
  });

  it('escapes a model name so it cannot open a path of its own', async () => {
    const calls = stubFetch({ candidates: [] });
    await new GoogleProvider().complete(context({ kind: 'google', model: 'a/b' }), REQUEST);
    expect(calls[0].url).toContain('models/a%2Fb:generateContent');
  });
});

describe('Anthropic provider', () => {
  it('sends the vendor request the SDK builds, and reads the text blocks', async () => {
    const calls = stubFetch({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'm-1',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'rewritten' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const text = await new AnthropicProvider().complete(
      context({ kind: 'anthropic' }),
      REQUEST,
    );

    expect(text).toBe('rewritten');
    expect(calls[0].url).toBe('https://api.example/v1/messages');
    const body = sentBody(calls);
    expect(body.model).toBe('m-1');
    expect(body.system).toBe('Be brief.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Rewrite these notes.' }]);
    // Recent models reject `temperature` outright, so none must ever be sent.
    expect(body).not.toHaveProperty('temperature');
  });

  it('reports a declined answer rather than reading it as an empty one', async () => {
    stubFetch({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'm-1',
      stop_reason: 'refusal',
      content: [],
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    await expect(
      new AnthropicProvider().complete(context({ kind: 'anthropic' }), REQUEST),
    ).rejects.toBeInstanceOf(CodedException);
  });
});

describe('vendor failures', () => {
  it('carries the vendor status and body into the coded error', async () => {
    stubFetch(null, { ok: false, text: 'invalid api key' });
    const error = await new OpenAiProvider()
      .complete(context(), REQUEST)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CodedException);
    const body = (error as CodedException).getResponse() as {
      code: string;
      params: { reason: string };
    };
    expect(body.code).toBe('errors.llm.callFailed');
    // What an admin needs to fix it — a code alone would only say "it failed".
    expect(body.params.reason).toContain('401');
    expect(body.params.reason).toContain('invalid api key');
  });
});
