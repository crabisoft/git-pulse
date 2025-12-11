import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import type { DeploymentBase, PipelineStatus } from '@repo/shared';
import { DoraQueryDto } from '../../dora/dto/dora-query.dto';

/** Every status a deployment may carry — the values `@IsIn` accepts. */
const STATUSES = [
  'success',
  'failed',
  'running',
  'pending',
  'canceled',
  'skipped',
  'unknown',
] as const satisfies readonly PipelineStatus[];

/** Accepts `?environment=a&environment=b` as well as `?environment=a,b`. */
function toList({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * The same period, scope and dimension slicing as the DORA report, extended
 * with what only a list needs. Inherited rather than restated: a deployments
 * page and a deployment-frequency metric that disagreed on what a period is
 * would be worse than either of them being wrong.
 */
export class ListDeploymentsDto extends DoraQueryDto {
  /** Environment names, matched exactly. Absent matches every one. */
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsString({ each: true })
  environment?: string[];

  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsIn(STATUSES, { each: true })
  status?: PipelineStatus[];
}

/** The repo and base a detail view is about, plus the period it was listed in. */
export class DeploymentChangesDto {
  @IsString()
  @Matches(/.+/)
  repo!: string;

  /**
   * Which baseline to compare against. Defaults to the previous deployment:
   * "what went out since the last time" is the question a deployment row most
   * often raises, and it stays answerable when the deployed ref is the default
   * branch — where comparing against that branch yields nothing.
   */
  @IsOptional()
  @IsIn(['previous', 'default', 'ref'])
  base?: DeploymentBase;

  /**
   * The ref to compare against when `base` is `ref` — a tag, a branch or a
   * commit. Its shape is checked in the service, which owns the rule.
   */
  @IsOptional()
  @IsString()
  ref?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  windowDays?: number;
}
