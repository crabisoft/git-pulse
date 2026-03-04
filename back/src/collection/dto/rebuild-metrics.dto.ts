import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DORA_WINDOW_MAX, DORA_WINDOW_MIN } from '@repo/shared';

/**
 * How far back to replay the metric history.
 *
 * Omitted means the DORA window: the period the metrics are read over, and the
 * one whose readings are worth restating first. Held to the same bounds a
 * window may take anywhere else — a replay is bounded by what was ingested
 * regardless, and asking for more simply writes nothing beyond it.
 */
export class RebuildMetricsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(DORA_WINDOW_MIN)
  @Max(DORA_WINDOW_MAX)
  days?: number;
}
