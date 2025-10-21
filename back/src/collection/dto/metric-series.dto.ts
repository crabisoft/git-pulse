import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsISO8601, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import type { MetricBucket } from '@repo/shared';

/** Accepts `?dimension=a:1&dimension=b:2` as well as `?dimension=a:1,b:2`. */
function toList({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** One metric, one dimension combination, over a period. */
export class MetricSeriesDto {
  @IsString()
  @MinLength(1)
  metric!: string;

  /**
   * Slices as the DORA endpoint does, `key:value`. An omitted filter means the
   * combination with no dimension at all, not "every combination": summing
   * unrelated slices into one line would be meaningless.
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

  @IsOptional()
  @IsEnum(['hour', 'day', 'week'] as const)
  bucket?: MetricBucket;
}
