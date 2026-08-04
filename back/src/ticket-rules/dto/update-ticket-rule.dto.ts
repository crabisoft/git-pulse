import { ArrayNotEmpty, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { TICKET_SOURCES, type TicketSource } from '@repo/shared';

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
  @ArrayNotEmpty()
  @IsIn(TICKET_SOURCES, { each: true })
  sources?: TicketSource[];

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
