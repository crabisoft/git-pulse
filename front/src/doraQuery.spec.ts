import { describe, expect, it } from 'vitest';
import { fromSearchParams, toSearchParams } from './doraQuery';

describe('DORA filters in a URL', () => {
  it('carries a period, a repo scope and a dimension slice', () => {
    const params = toSearchParams({
      from: '2026-01-01',
      to: '2026-01-31',
      repos: ['api', 'web'],
      dimensions: { app: 'Extranet', type: 'Prod' },
    });

    expect(params.get('from')).toBe('2026-01-01');
    expect(params.getAll('repos')).toEqual(['api', 'web']);
    expect(params.getAll('dimension')).toEqual(['app:Extranet', 'type:Prod']);
  });

  it('survives a round trip, which is what links between the two pages rely on', () => {
    const query = {
      windowDays: 90,
      repos: ['api'],
      dimensions: { app: 'Extranet' },
      from: undefined,
      to: undefined,
    };
    expect(fromSearchParams(toSearchParams(query))).toEqual(query);
  });

  it('omits what was never set rather than sending it empty', () => {
    const params = toSearchParams({ repos: [], dimensions: {} });
    expect([...params.keys()]).toEqual([]);
  });

  it('keeps a colon inside a dimension value', () => {
    const back = fromSearchParams(new URLSearchParams('dimension=url:https://acme.io'));
    expect(back.dimensions).toEqual({ url: 'https://acme.io' });
  });

  it('ignores a malformed pair instead of inventing an empty key', () => {
    const back = fromSearchParams(new URLSearchParams('dimension=broken&dimension=:novalue'));
    expect(back.dimensions).toEqual({});
  });
});
