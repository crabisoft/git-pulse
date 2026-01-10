import { Transform } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString, Matches, MinLength } from 'class-validator';

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
}
