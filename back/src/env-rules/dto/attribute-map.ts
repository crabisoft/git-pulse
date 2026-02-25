import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * Keys take the shape of a named capture group, on purpose: downstream nothing
 * knows whether an attribute was captured or forced, and a slice reads the same
 * either way.
 */
const KEY = /^[A-Za-z_$][\w$]*$/;

/** A flat map of attributes a rule forces — non-empty strings, name-shaped keys. */
export function IsAttributeMap(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isAttributeMap',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          return Object.entries(value as Record<string, unknown>).every(
            ([key, v]) => KEY.test(key) && typeof v === 'string' && v.length > 0,
          );
        },
        defaultMessage: () =>
          'attributes must map name-shaped keys to non-empty strings, e.g. {"App":"Billing"}',
      },
    });
  };
}
