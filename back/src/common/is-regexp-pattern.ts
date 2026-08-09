import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * A string the platform's own RegExp engine can read.
 *
 * Refused at the door rather than swallowed downstream: the reader who typed it
 * is still holding the field, and can be shown where the typo is. What consumes
 * these patterns afterwards treats an unreadable one as matching nothing — the
 * only safe reading in a classifier, and a silent one, which is exactly what a
 * form must not be.
 */
export function IsRegExpPattern(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isRegExpPattern',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          try {
            new RegExp(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return `${propertyName} must be a valid regular expression`;
        },
      },
    });
  };
}
