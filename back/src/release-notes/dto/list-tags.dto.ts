import { IsString, MinLength } from 'class-validator';

export class ListTagsDto {
  @IsString()
  @MinLength(1)
  repo!: string;
}
