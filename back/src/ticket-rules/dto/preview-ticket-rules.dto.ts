import { IsOptional, IsString } from 'class-validator';

/**
 * Runs a source's saved rules over a sample branch and title. The rules are not
 * posted inline as the classification preview does: a rule now only means
 * something together with its tracker, so it is read from storage.
 */
export class PreviewTicketRulesDto {
  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  title?: string;

  /** Stands in for the repo a real PR would carry, so git-hosted links resolve. */
  @IsOptional()
  @IsString()
  repo?: string;
}
