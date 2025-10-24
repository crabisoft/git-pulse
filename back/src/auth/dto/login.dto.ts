import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  /** No minimum here: the stored password decides, not today's policy. */
  @IsString()
  @MinLength(1)
  password!: string;
}
