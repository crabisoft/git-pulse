import { IsOptional, IsString, MinLength } from 'class-validator';
import { IsRegExpPattern } from '../../common/is-regexp-pattern';

/** Which repo to summarise, and between which two refs. */
export class GenerateReleaseNotesDto {
  @IsString()
  @MinLength(1)
  repo!: string;

  /** Omitted, the tag before `to` — or the whole history when there is none. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  from?: string;

  /** Omitted, the most recent tag, or the default branch when none exists. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  to?: string;

  /**
   * Which tags are releases of the thing being summarised, as a RegEx —
   * `^front@` on a repo that tags several components. Omitted, every tag is.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @IsRegExpPattern()
  tagPattern?: string;
}
