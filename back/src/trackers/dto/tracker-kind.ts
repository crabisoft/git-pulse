import type { TrackerKind } from '@repo/shared';

/** The values `@IsEnum` accepts for a tracker kind. Declared once, on purpose. */
export const TRACKER_KINDS = ['jira', 'linear', 'github', 'gitlab'] as const satisfies readonly TrackerKind[];
