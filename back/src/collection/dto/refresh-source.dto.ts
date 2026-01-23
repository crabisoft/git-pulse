import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { SOURCE_HISTORY_MAX, SOURCE_HISTORY_MIN } from '@repo/shared';

/**
 * What a forced refresh may be told beyond which source to re-read.
 *
 * The depth is **persisted on the source** rather than applied to this run
 * alone, and that is the whole design: the purge sweeps each source at its own
 * depth, so a run that read a year into a source configured for a month would
 * see it deleted at the next sweep — a full API budget spent on rows with a
 * quarter of an hour to live. Asking for a year here means the source keeps a
 * year from now on.
 */
export class RefreshSourceDto {
  @IsOptional()
  @IsInt()
  @Min(SOURCE_HISTORY_MIN)
  @Max(SOURCE_HISTORY_MAX)
  historyDays?: number;
}
