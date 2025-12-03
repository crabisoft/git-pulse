import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { REWRITE_MAX_CHARS } from '../rewrite';

/**
 * The notes travel in the request rather than being regenerated from a range:
 * generating them costs a burst of connector calls, and the caller is holding
 * the result already.
 */
export class RewriteReleaseNotesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(REWRITE_MAX_CHARS)
  markdown!: string;

  /** Omitted, the default provider — and a 400 when the install declared none. */
  @IsOptional()
  @IsUUID()
  providerId?: string;

  /** BCP 47 tag. Omitted, the notes stay in the language they are in. */
  @IsOptional()
  @IsString()
  @MaxLength(35)
  language?: string;
}
