import { Transform } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';

/** Accepts `?repo=a&repo=b` as well as `?repo=a,b`, like every other list route. */
function toList({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * What narrows the archive.
 *
 * Deliberately not the DORA query the other lists inherit: those are about a
 * rolling window, and this one is about everything ever filed. A reader here
 * has come looking for last spring, so the absence of a period means the whole
 * history rather than the configured window.
 */
export class ListChangelogsDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsString({ each: true })
  repo?: string[];

  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsString({ each: true })
  environment?: string[];

  /** Matched against the rendered text and the deployed ref. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
