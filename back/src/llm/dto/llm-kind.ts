import { LLM_KINDS, type LlmKind } from '@repo/shared';

/** The values `@IsEnum` accepts for a provider kind, from the shared list. */
export const LLM_KIND_VALUES = [...LLM_KINDS] as [LlmKind, ...LlmKind[]];
