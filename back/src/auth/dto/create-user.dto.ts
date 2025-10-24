import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH, type UserRole } from '@repo/shared';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password!: string;

  /** Omitted means `user`: the role that can do the least. */
  @IsOptional()
  @IsEnum(['admin', 'user'] as const)
  role?: UserRole;
}
