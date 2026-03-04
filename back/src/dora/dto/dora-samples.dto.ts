import { IsIn } from 'class-validator';
import { DORA_METRICS, type DoraMetric } from '@repo/shared';
import { DoraQueryDto } from './dora-query.dto';
import { IsLimit, IsOffset } from '../../common/pagination';

/**
 * The events behind one metric: the same period and slice the value was
 * computed over, plus a page window.
 *
 * Extends the report's own query rather than restating it — a list of events
 * answering to a different period than the figure it explains would be worse
 * than no list at all.
 */
export class DoraSamplesDto extends DoraQueryDto {
  @IsIn(DORA_METRICS)
  metric!: DoraMetric;

  @IsLimit()
  limit?: number;

  @IsOffset()
  offset?: number;
}
