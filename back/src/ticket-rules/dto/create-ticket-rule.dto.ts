import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
