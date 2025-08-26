import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

/** Partial update — only the supplied keys are persisted. */
export class UpdateSettingsDto {
  @IsOptional()
  @IsInt()
  doraWindowDays?: number;

  @IsOptional()
  @IsInt()
  stalePrHours?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  collectCron?: string;
}
