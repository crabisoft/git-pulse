import { IsEnum, IsOptional } from 'class-validator';
import type { RuleTarget } from '@repo/shared';
import { PaginationQueryDto } from '../../common/pagination';

/** Rules are listed one target at a time; omitting it lists environment rules. */
export class ListEnvRulesDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(['environment', 'repository'] as const)
  target?: RuleTarget;
}
