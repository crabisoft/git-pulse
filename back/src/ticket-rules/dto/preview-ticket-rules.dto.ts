import { IsOptional, IsString } from 'class-validator';

/**
 * Runs the saved rules over a sample branch and title. They are not posted
 * inline as the classification preview does: a rule only means something
 * together with its tracker, so it is read from storage.
 */
export class PreviewTicketRulesDto {
  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  title?: string;

  /** Stand in for what a real PR carries, so git-hosted links resolve. */
  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  repo?: string;
}
