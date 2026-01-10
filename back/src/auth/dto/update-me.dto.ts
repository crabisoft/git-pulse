import { IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import {
  DISPLAY_MODES,
  OVERVIEW_DIRECTIONS,
  PASSWORD_MIN_LENGTH,
  type DisplayMode,
  type OverviewDirection,
} from '@repo/shared';

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

  /**
   * The presentation this account reads in. Null is a value here and not an
   * omission: it hands the choice back to the installation default, which is
   * the only way to stop overriding it once one has.
   */
  @IsOptional()
  @IsEnum(OVERVIEW_DIRECTIONS)
  displayDirection?: OverviewDirection | null;

  @IsOptional()
  @IsEnum(DISPLAY_MODES)
  displayMode?: DisplayMode | null;
}
