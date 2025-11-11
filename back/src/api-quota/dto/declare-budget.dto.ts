import { IsInt } from 'class-validator';

/**
 * A ceiling declared by hand. The subject is addressed by the route, and the
 * bucket follows from its platform — only the main bucket can be declared, the
 * others being metered by every instance that has them.
 */
export class DeclareBudgetDto {
  /** Calls allowed per window. */
  @IsInt()
  limit!: number;

  /** Window length, in seconds. */
  @IsInt()
  windowSec!: number;
}
