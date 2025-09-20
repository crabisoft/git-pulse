import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** Partial update — only the supplied keys are persisted. */
export class UpdateTicketRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  trackerId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  pattern?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
