import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { IsLimit, IsOffset } from '../../common/pagination';

/** Accepts `?repos=a&repos=b` as well as `?repos=a,b`. */
function toRepoList({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((repo) => repo.trim())
    .filter(Boolean);
}

/**
 * The live view bundles three lists, each with its own window so the client can
 * page through one without disturbing the others.
 */
export class DashboardLiveQueryDto {
  /** Repo filter applied before summarizing; omitted means every repo in scope. */
  @IsOptional()
  @Transform(toRepoList)
  @IsArray()
  @IsString({ each: true })
  repos?: string[];

  @IsLimit()
  prsLimit?: number;

  @IsOffset()
  prsOffset?: number;

  @IsLimit()
  pipelinesLimit?: number;

  @IsOffset()
  pipelinesOffset?: number;

  @IsLimit()
  environmentsLimit?: number;

  @IsOffset()
  environmentsOffset?: number;
}
