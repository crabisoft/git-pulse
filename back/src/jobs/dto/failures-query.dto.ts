import { IsIn, IsOptional } from 'class-validator';
import { QUEUE_NAMES, type QueueName } from '@repo/shared';
import { PaginationQueryDto } from '../../common/pagination';

/** Failed jobs of one queue, or of every queue when none is named. */
export class FailuresQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(QUEUE_NAMES)
  queue?: QueueName;
}
