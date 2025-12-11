import { describe, expect, it } from 'vitest';
import { isValidGitRef } from './git-ref';

describe('isValidGitRef', () => {
  it('accepts the three things a reader actually types', () => {
    expect(isValidGitRef('v2.1.0')).toBe(true);
    expect(isValidGitRef('release/3.0')).toBe(true);
    expect(isValidGitRef('3f2a91c8e4d5b6a7f8091a2b3c4d5e6f70819a2b')).toBe(true);
  });

  it('accepts a dash anywhere but first', () => {
    // `v1.0-rc1` is an ordinary tag; rejecting every dash would rule out most
    // pre-release names.
    expect(isValidGitRef('v1.0-rc1')).toBe(true);
    expect(isValidGitRef('feature/PAY-42-refund')).toBe(true);
    expect(isValidGitRef('-force')).toBe(false);
  });

  it('rejects a ref carrying the range separator', () => {
    // The compare endpoints are built around `base...head`: a ref with `..` in
    // it would be read as a second bound, answering another question silently.
    expect(isValidGitRef('main...HEAD')).toBe(false);
    expect(isValidGitRef('v1..v2')).toBe(false);
  });

  it('rejects what git itself forbids in a ref name', () => {
    for (const ref of ['a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[0]', 'a\\b', 'a\tb']) {
      expect(isValidGitRef(ref), ref).toBe(false);
    }
  });

  it('rejects the empty ref and an absurdly long one', () => {
    expect(isValidGitRef('')).toBe(false);
    expect(isValidGitRef('a'.repeat(256))).toBe(false);
    expect(isValidGitRef('a'.repeat(255))).toBe(true);
  });
});
