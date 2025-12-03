import { HttpStatus } from '@nestjs/common';
import { CodedException } from '../../common/coded-exception';

/**
 * Output ceiling for a rewriting. Generous: the notes of a busy release run
 * long, and a ceiling reached mid-sentence is worse than a slow answer.
 */
export const LLM_MAX_TOKENS = 16_000;

/**
 * One JSON POST, for the vendors reached without an SDK. Their errors travel as
 * a status code and a body we have no schema for, so the body is passed through
 * as text — truncated, since a proxy answering HTML would otherwise fill the
 * logs with a page.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new CodedException('errors.llm.callFailed', HttpStatus.BAD_GATEWAY, {
      reason: asMessage(e),
    });
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new CodedException('errors.llm.callFailed', HttpStatus.BAD_GATEWAY, {
      reason: `${response.status} ${detail}`.trim(),
    });
  }
  return response.json();
}

export function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
