import type { VersionAuthKind, VersionFormat } from '@repo/shared';

/** Spelled out for `@IsEnum`, which needs the values at runtime. */
export const VERSION_FORMATS: readonly VersionFormat[] = ['json', 'xml', 'text'];

export const VERSION_AUTH_KINDS: readonly VersionAuthKind[] = ['none', 'bearer', 'basic', 'header'];
