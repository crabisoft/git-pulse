import { describe, expect, it } from 'vitest';
import { classifyEnvironment, type EnvRuleLike } from './env-classifier';

const rule = (over: Partial<EnvRuleLike> = {}): EnvRuleLike => ({
  name: 'rule',
  pattern: '.*',
  kind: 'simple',
  priority: 100,
  ...over,
});

describe('classifyEnvironment', () => {
  it('turns named groups into attributes', () => {
    const result = classifyEnvironment('acme-prod', [
      rule({ pattern: '^(?<client>\\w+)-(?<type>prod|rec)$' }),
    ]);
    expect(result.attributes).toEqual({ client: 'acme', type: 'prod' });
  });

  it('accumulates attributes across rules', () => {
    const result = classifyEnvironment('acme-prod-back', [
      rule({ name: 'client', pattern: '^(?<client>\\w+)-' }),
      rule({ name: 'app', pattern: '-(?<app>back|front)$' }),
    ]);
    expect(result.attributes).toEqual({ client: 'acme', app: 'back' });
  });

  it('lets the lower priority number win an attribute conflict', () => {
    const contested = (priority: number, value: string) =>
      rule({ name: `p${priority}`, pattern: `^(?<type>${value})`, priority });
    const rules = [contested(50, 'prod'), contested(10, 'pro')];

    // Declaration order must not decide — priority does, either way round.
    expect(classifyEnvironment('prod', rules).attributes).toEqual({ type: 'pro' });
    expect(classifyEnvironment('prod', [...rules].reverse()).attributes).toEqual({ type: 'pro' });
  });

  it('adds the rule name as a meta-environment, cumulatively', () => {
    const result = classifyEnvironment('acme-prod', [
      rule({ name: 'Production', pattern: 'prod', kind: 'meta' }),
      rule({ name: 'Acme', pattern: '^acme', kind: 'meta' }),
    ]);
    expect(result.metaEnvironments).toEqual(['Acme', 'Production']);
  });

  it('ignores the named groups of a meta rule', () => {
    const result = classifyEnvironment('acme-prod', [
      rule({ name: 'Production', pattern: '(?<type>prod)', kind: 'meta' }),
    ]);
    expect(result.attributes).toEqual({});
    expect(result.metaEnvironments).toEqual(['Production']);
  });

  it('skips an invalid pattern instead of throwing', () => {
    const result = classifyEnvironment('acme-prod', [
      rule({ name: 'broken', pattern: '([' }),
      rule({ name: 'good', pattern: '(?<type>prod)' }),
    ]);
    expect(result.attributes).toEqual({ type: 'prod' });
  });

  it('matches unanchored, which is what makes `^` and `$` worth documenting', () => {
    const anywhere = classifyEnvironment('preprod-acme', [rule({ pattern: '(?<type>prod)' })]);
    expect(anywhere.attributes).toEqual({ type: 'prod' });

    const anchored = classifyEnvironment('preprod-acme', [rule({ pattern: '^(?<type>prod)' })]);
    expect(anchored.attributes).toEqual({});
  });

  it('returns the name untouched when nothing matches', () => {
    const result = classifyEnvironment('staging', [rule({ pattern: '^prod$' })]);
    expect(result).toEqual({ name: 'staging', attributes: {}, metaEnvironments: [] });
  });
});
