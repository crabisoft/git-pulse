import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('accepts the password it was derived from', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects anything else', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts, so the same password never yields the same hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('answers false on a stored hash it cannot read, rather than throwing', async () => {
    const valid = await hashPassword('whatever');
    const [salt, key] = valid.split(':');
    const corrupt = [
      '',
      'nonsense',
      'no-colon-here',
      ':',
      // Decodes to nothing at all — the case that must never compare equal.
      'zz:zz',
      `${salt}:`,
      // Right shape, wrong sizes.
      `${salt}:${key.slice(0, -2)}`,
      `${salt.slice(0, -2)}:${key}`,
      // A third field is not a hash this function wrote.
      `${salt}:${key}:${key}`,
    ];
    for (const stored of corrupt) {
      expect(await verifyPassword('any', stored), stored).toBe(false);
    }
  });
});
