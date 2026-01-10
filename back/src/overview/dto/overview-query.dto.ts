import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { DORA_WINDOW_MAX, DORA_WINDOW_MIN } from '@repo/shared';

/** Accepts `?repos=a&repos=b` as well as `?repos=a,b`. */
function toList({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * The scope of an overview. No page window: the environments come back whole
 * because the page pivots them, and half a pivot is not half an answer.
 */
export class OverviewQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Rolling window ending at `to`, falling back to `AppSettings.doraWindowDays`. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(DORA_WINDOW_MIN)
  @Max(DORA_WINDOW_MAX)
  windowDays?: number;

  /** Scopes the collection itself: fewer repos means fewer connector calls. */
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsString({ each: true })
  repos?: string[];

  /**
   * Slices on the attributes the classification rules extract, as `key:value`
   * pairs — `?dimension=type:prod&dimension=client:acme`.
   */
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @Matches(/^[^:]+:.+$/, { each: true })
  dimension?: string[];

  /** Keeps only the environments carrying this meta-environment. */
  @IsOptional()
  @IsString()
  meta?: string;
}
