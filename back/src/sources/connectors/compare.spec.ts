import { describe, expect, it } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { isNotFound, unresolvableRange } from './compare';

describe('isNotFound', () => {
  it('recognises what Octokit refuses with', () => {
    expect(isNotFound({ status: 404, message: 'Not Found' })).toBe(true);
    expect(isNotFound({ status: 403 })).toBe(false);
  });

  it('recognises what gitbeaker keeps under its cause', () => {
    expect(isNotFound({ cause: { response: { status: 404 } } })).toBe(true);
    expect(isNotFound({ cause: { response: { status: 500 } } })).toBe(false);
  });

  it('says nothing of an error that carries no status at all', () => {
    expect(isNotFound(new Error('socket hang up'))).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
  });
});

describe('unresolvableRange', () => {
  it('reports a range the platform will not resolve, naming both bounds', () => {
    const error = unresolvableRange('widget', 'v1.9.0', 'v2.0.0');

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.getResponse()).toEqual({
      code: 'errors.compare.unresolvable',
      params: { repo: 'widget', from: 'v1.9.0', to: 'v2.0.0' },
    });
  });

  it('names the single ref when there was no lower bound to compare against', () => {
    // A history walked from the beginning has no range: the 404 is about the
    // one ref that was asked for, and naming a second would invent it.
    expect(unresolvableRange('widget', null, 'v2.0.0').getResponse()).toEqual({
      code: 'errors.compare.unknownRef',
      params: { repo: 'widget', ref: 'v2.0.0' },
    });
  });
});
