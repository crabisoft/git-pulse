import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { DORA_WINDOW_MAX, DORA_WINDOW_MIN } from '@repo/shared';

/** Accepts `?dimension=a:1&dimension=b:2` as well as `?dimension=a:1,b:2`. */
function toList({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** One metric over a period, sliced by whatever the reader filtered on. */
export class MetricSeriesDto {
  @IsString()
  @MinLength(1)
  metric!: string;

  /**
   * Slices as the DORA endpoint does, `key:value`. A partial filter keeps every
   * combination that carries those pairs and folds them into one line — the
   * same reading the value beside the chart is folded to.
   */
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @Matches(/^[^:]+:.+$/, { each: true })
  dimension?: string[];

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /**
   * Rolling window, exactly as the DORA endpoint takes it.
   *
   * Without it a chart could only be bounded by explicit dates, and a reader
   * who picked "the last 90 days" — which sets no bounds at all — got a line
   * drawn over every snapshot ever taken, beside a value computed over ninety
   * days. The two have to be resolved the same way to mean anything together.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(DORA_WINDOW_MIN)
  @Max(DORA_WINDOW_MAX)
  windowDays?: number;
}
