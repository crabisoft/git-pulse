import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Typed by hand: `promisify` picks the overload without options, and the cost
 * parameters below are exactly what this call is for.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * scrypt rather than a hashing library: it is memory-hard, it ships with Node,
 * and this codebase already leans on `node:crypto` for secrets at rest. One
 * fewer dependency on the path where a mistake costs the most.
 *
 * Parameters follow the usual interactive-login recommendation. They are stored
 * nowhere, so raising them later means rehashing on next sign-in, not a
 * migration — worth remembering before anyone tunes them.
 */
const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Node caps scrypt at 32 MiB by default, and these parameters need exactly
 * that much for the block alone — so the cap has to be raised or every call
 * throws. Derived from the parameters rather than written out, so tuning the
 * cost above cannot silently break hashing again.
 */
const PARAMS = {
  N: COST,
  r: BLOCK_SIZE,
  p: PARALLELISM,
  maxmem: 2 * 128 * COST * BLOCK_SIZE,
};

/** `salt:derivedKey`, both hex. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

/**
 * Compares in constant time. A stored hash that cannot be read answers false
 * rather than throwing: a corrupted row must fail to authenticate, not crash
 * the route — and it must fail, which is why the halves are checked strictly
 * before anything is compared.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex, ...extra] = stored.split(':');
  if (extra.length > 0) return false;

  const salt = fromHex(saltHex, SALT_LENGTH);
  const expected = fromHex(keyHex, KEY_LENGTH);
  if (!salt || !expected) return false;

  try {
    return timingSafeEqual(await scrypt(password, salt, KEY_LENGTH, PARAMS), expected);
  } catch {
    return false;
  }
}

/**
 * Strictly, and for a reason: `Buffer.from` silently drops what it cannot read,
 * so a garbled column would decode to an empty buffer — and `timingSafeEqual`
 * of two empty buffers is true, which would let that row accept any password.
 */
function fromHex(value: string | undefined, bytes: number): Buffer | null {
  if (value === undefined || value.length !== bytes * 2 || !/^[0-9a-f]+$/i.test(value)) return null;
  return Buffer.from(value, 'hex');
}
