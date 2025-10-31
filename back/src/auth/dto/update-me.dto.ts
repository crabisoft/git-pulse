import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '@repo/shared';

/**
 * What an account may change about itself. No role and no email: an admin
 * hands those out, and letting an account rewrite either would let it rename
 * itself out from under the person who granted it.
 */
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password?: string;

  /** Required only when the password is being replaced — it is what proves it may be. */
  @ValidateIf((dto: UpdateMeDto) => dto.password !== undefined)
  @IsString()
  @MinLength(1)
  currentPassword?: string;
}
