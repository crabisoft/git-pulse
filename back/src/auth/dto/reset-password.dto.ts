import { IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '@repo/shared';

/** The link's token stands in for the credentials — it is the whole proof. */
export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password!: string;
}
