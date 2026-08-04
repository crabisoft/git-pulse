import { IsOptional, IsString } from 'class-validator';

/**
 * Runs the saved rules over a sample. They are not posted inline as the
 * classification preview does: a rule only means something together with its
 * tracker, so it is read from storage.
 *
 * One field per text a rule may read, so the tester answers the question the
 * rule form now asks — which of them this pattern applies to.
 */
export class PreviewTicketRulesDto {
  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  title?: string;

  /** The pull request's description. */
  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  commit?: string;

  /** Stand in for what a real PR carries, so git-hosted links resolve. */
  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  repo?: string;
}
