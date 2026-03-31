import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Header names, as the HTTP grammar spells them. */
const NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * A flat map of request headers.
 *
 * Values are refused a carriage return or a newline, which is not a formality:
 * a value carrying one splits the request and appends whatever follows as a
 * header of its own — and these values are typed into a form by a tenant. The
 * HTTP client refuses them too, but at the far end of a probe, where the reason
 * reaches nobody who can act on it.
 */
export function IsHeaderMap(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isHeaderMap',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          return Object.entries(value as Record<string, unknown>).every(
            ([key, v]) => NAME.test(key) && typeof v === 'string' && !/[\r\n]/.test(v),
          );
        },
        defaultMessage: () =>
          'headers must map header names to values holding no line break, e.g. {"x-api-version":"2"}',
      },
    });
  };
}
