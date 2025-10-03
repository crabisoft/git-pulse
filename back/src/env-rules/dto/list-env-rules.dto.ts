import { IsEnum, IsOptional } from 'class-validator';
import type { RuleTarget } from '@repo/shared';
import { RULE_TARGETS } from './rule-target';
import { PaginationQueryDto } from '../../common/pagination';

/** Rules are listed one target at a time; omitting it lists environment rules. */
export class ListEnvRulesDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(RULE_TARGETS)
  target?: RuleTarget;
}
