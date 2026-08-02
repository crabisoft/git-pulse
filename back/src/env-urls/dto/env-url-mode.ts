import type { EnvUrlMode } from '@repo/shared';

/** The enum as a value, for `@IsEnum` — the shared type is erased at runtime. */
export const ENV_URL_MODES: readonly EnvUrlMode[] = ['fill', 'overwrite'];
