import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DoraQueryDto, toDimensionFilter } from './dora-query.dto';

function parse(payload: unknown): DoraQueryDto {
  return plainToInstance(DoraQueryDto, payload);
}

function reject(payload: unknown): string[] {
  return validateSync(parse(payload) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((e) => e.property);
}

describe('DoraQueryDto', () => {
  it('reads a repeated parameter and a comma-separated one the same way', () => {
    expect(parse({ repos: ['a', 'b'] }).repos).toEqual(['a', 'b']);
    expect(parse({ repos: 'a,b' }).repos).toEqual(['a', 'b']);
    expect(parse({ repos: 'a, b , ' }).repos).toEqual(['a', 'b']);
  });

  it('accepts a window inside the bounds a window may take', () => {
    expect(reject({ windowDays: 730 })).toEqual([]);
  });

  it('rejects a window wider than any preset', () => {
    expect(reject({ windowDays: 731 })).toEqual(['windowDays']);
    expect(reject({ windowDays: 0 })).toEqual(['windowDays']);
  });

  it('rejects a bound that is not a date', () => {
    expect(reject({ from: 'last monday' })).toEqual(['from']);
  });

  it('rejects a dimension that carries no value', () => {
    expect(reject({ dimension: 'app' })).toEqual(['dimension']);
    expect(reject({ dimension: ':prod' })).toEqual(['dimension']);
  });

  it('rejects a property no route declares', () => {
    expect(reject({ metric: 'lead_time' })).toEqual(['metric']);
  });
});

describe('toDimensionFilter', () => {
  it('turns the pairs into the record the service slices on', () => {
    expect(toDimensionFilter(['app:Portal', 'type:Prod'])).toEqual({
      app: 'Portal',
      type: 'Prod',
    });
  });

  it('keeps a colon inside the value, splitting on the first one only', () => {
    expect(toDimensionFilter(['url:https://acme.io'])).toEqual({ url: 'https://acme.io' });
  });

  it('lets the last of a repeated key win rather than merging them', () => {
    expect(toDimensionFilter(['app:a', 'app:b'])).toEqual({ app: 'b' });
  });

  it('answers an empty filter when nothing was asked', () => {
    expect(toDimensionFilter(undefined)).toEqual({});
  });
});
