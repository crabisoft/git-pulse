import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH, type UserRole } from '@repo/shared';

/** Partial update — only the supplied keys change. Omitting the password keeps it. */
export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password?: string;

  @IsOptional()
  @IsEnum(['admin', 'user'] as const)
  role?: UserRole;
}
