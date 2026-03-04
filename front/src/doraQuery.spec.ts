import { describe, expect, it } from 'vitest';
import { fromDoraParams, fromSearchParams, toSearchParams } from './doraQuery';

describe('DORA filters in a URL', () => {
  it('carries a period, a repo scope and a dimension slice', () => {
    const params = toSearchParams({
      from: '2026-01-01',
      to: '2026-01-31',
      repos: ['api', 'web'],
      dimensions: { app: 'Portal', type: 'Prod' },
    });

    expect(params.get('from')).toBe('2026-01-01');
    expect(params.getAll('repos')).toEqual(['api', 'web']);
    expect(params.getAll('dimension')).toEqual(['app:Portal', 'type:Prod']);
  });

  it('survives a round trip, which is what links between the two pages rely on', () => {
    const query = {
      windowDays: 90,
      repos: ['api'],
      dimensions: { app: 'Portal' },
      from: undefined,
      to: undefined,
    };
    expect(fromSearchParams(toSearchParams(query))).toEqual(query);
  });

  it('drops a repo scope on the DORA pages, even one typed into the address', () => {
    // Those pages report over every repo, because their trends have no choice:
    // a snapshot records a metric and its dimensions, never its repo. A value
    // narrowed to one repo would sit above a line drawn from all of them.
    const back = fromDoraParams(new URLSearchParams('repos=api&repos=web&dimension=type:Prod'));

    expect(back.repos).toBeUndefined();
    expect(back.dimensions).toEqual({ type: 'Prod' });
  });

  it('leaves the scope alone for the readers that do filter on it', () => {
    // The overview keeps its repo filter, and reads the same vocabulary.
    const back = fromSearchParams(new URLSearchParams('repos=api&repos=web'));
    expect(back.repos).toEqual(['api', 'web']);
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
