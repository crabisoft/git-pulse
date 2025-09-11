import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { DORA_WINDOW_MAX, DORA_WINDOW_MIN } from '@repo/shared';
import { PaginationQueryDto } from '../../common/pagination';

/** Accepts `?repos=a&repos=b` as well as `?repos=a,b`. */
function toList({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Reporting period, scope and slicing, plus the page window. */
export class DoraQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /**
   * Rolling window ending at `to`, in days — how the period dropdown asks for
   * "the last 3 months". Ignored when `from` is supplied, and falling back to
   * `AppSettings.doraWindowDays` when neither is.
   */
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
   * Slices the computed results by dimension, as `key:value` pairs — e.g.
   * `?dimension=app:extranet&dimension=type:Prod`. Repeated keys are not
   * combined: the last one wins.
   */
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @Matches(/^[^:]+:.+$/, { each: true })
  dimension?: string[];
}

/** Turns the `key:value` pairs into the record the service filters on. */
export function toDimensionFilter(pairs?: string[]): Record<string, string> {
  const filter: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const separator = pair.indexOf(':');
    filter[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return filter;
}
