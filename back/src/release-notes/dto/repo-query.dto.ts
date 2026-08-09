import { IsOptional, IsString, MinLength } from 'class-validator';
import { IsRegExpPattern } from '../../common/is-regexp-pattern';

/** The repo a listing is about — tags, branches. Nothing else addresses them. */
export class RepoQueryDto {
  @IsString()
  @MinLength(1)
  repo!: string;

  /**
   * Narrows a tag listing to one component's releases. Ignored by the branch
   * listing, which a monorepo does not split the same way — branches are named
   * by whoever cut them, tags by whatever released.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @IsRegExpPattern()
  tagPattern?: string;
}
