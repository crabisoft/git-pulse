import type { LlmKind } from '@repo/shared';

/** A resolved provider: what to call, with what, on whose key. */
export interface LlmContext {
  kind: LlmKind;
  /** Vendor model identifier, as the vendor spells it. */
  model: string;
  /** Already defaulted from the kind — an implementation never has to. */
  baseUrl: string;
  apiKey: string;
  /** Abandoned by the caller, so a rewriting nobody waits on stops. */
  signal?: AbortSignal;
}

/** One completion: instructions, a text to work on, and the text that comes back. */
export interface LlmRequest {
  /** How to behave. Sent as the vendor's system channel, whatever it is called. */
  system: string;
  /** What to work on. */
  prompt: string;
}

/**
 * A model API, reduced to what this application asks of one: a single
 * completion, no conversation, no tools, no streaming.
 *
 * Deliberately poor. Every vendor offers far more, and the day one of them is
 * needed for something else, this interface widens rather than the callers
 * learning which vendor they are holding.
 *
 * No sampling knobs cross it either: the vendors disagree on which exist —
 * recent Anthropic models reject `temperature` outright — so each
 * implementation sets what is right for its own API.
 */
export interface LlmProvider {
  readonly kind: LlmKind;
  complete(ctx: LlmContext, request: LlmRequest): Promise<string>;
}
