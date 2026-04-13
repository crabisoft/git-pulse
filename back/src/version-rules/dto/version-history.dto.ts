import { IsString, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';

/**
 * Which environment's timeline to read.
 *
 * Both halves required, and neither defaulted: a timeline is about one
 * environment of one repo, and the same environment name in two repos is two
 * different stories — answering for whichever came first would be answering a
 * question nobody asked.
 */
export class VersionHistoryDto extends PaginationQueryDto {
  @IsString()
  @MinLength(1)
  repo!: string;

  @IsString()
  @MinLength(1)
  environment!: string;
}
