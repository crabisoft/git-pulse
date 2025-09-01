import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';

/** Time-series read: optional metric / range filter, plus the page window. */
export class MetricsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  metric?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
