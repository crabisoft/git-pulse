import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';
import { DORA_WINDOW_MAX, DORA_WINDOW_MIN } from '@repo/shared';

/** Accepts `?repos=a&repos=b` as well as `?repos=a,b`. */
function toList({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The same period vocabulary every report speaks, and the same repo scope. */
export class IncidentsQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(DORA_WINDOW_MIN)
  @Max(DORA_WINDOW_MAX)
  windowDays?: number;

  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsString({ each: true })
  repos?: string[];
}
