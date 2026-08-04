import { ArrayNotEmpty, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { TICKET_SOURCES, type TicketSource } from '@repo/shared';

export class CreateTicketRuleDto {
  @IsString()
  @MinLength(1)
  trackerId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  pattern!: string;

  /** Omitted keeps the column default, which is what the extraction read before. */
  @IsOptional()
  @ArrayNotEmpty()
  @IsIn(TICKET_SOURCES, { each: true })
  sources?: TicketSource[];

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
