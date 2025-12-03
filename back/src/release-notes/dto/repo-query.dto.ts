import { IsString, MinLength } from 'class-validator';

/** The repo a listing is about — tags, branches. Nothing else addresses them. */
export class RepoQueryDto {
  @IsString()
  @MinLength(1)
  repo!: string;
}
