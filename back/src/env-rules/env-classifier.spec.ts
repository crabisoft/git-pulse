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

  it('forces attributes the name carries nothing to capture', () => {
    // The case the feature exists for: ProdContoso names its customer but never
    // its application, so no group could ever yield one.
    const result = classifyEnvironment('ProdContoso', [
      rule({ name: 'env', pattern: '^(?<Env>Prod|Preprod)', priority: 20 }),
      rule({ name: 'customer', pattern: '(?<Customer>Contoso|Globex)', priority: 30 }),
      rule({
        name: 'contoso defaults',
        pattern: '^(Prod|Preprod)Contoso',
        priority: 90,
        attributes: { App: 'Billing' },
      }),
    ]);
    expect(result.attributes).toEqual({ Env: 'Prod', Customer: 'Contoso', App: 'Billing' });
  });

  it('lets a lower priority capture beat a forced attribute, and the reverse', () => {
    const forced = rule({ name: 'forced', pattern: '^Prod', priority: 90, attributes: { App: 'Billing' } });
    const captured = rule({ name: 'keywords', pattern: '(?<App>Portal)', priority: 30 });

    expect(classifyEnvironment('ProdContosoPortal', [forced, captured]).attributes.App).toBe(
      'Portal',
    );
    // Same pair, priorities swapped: the forced value is not special, priority decides.
    expect(
      classifyEnvironment('ProdContosoPortal', [
        { ...forced, priority: 10 },
        captured,
      ]).attributes.App,
    ).toBe('Billing');
  });

  it('lets a group that matched beat the value the same rule forces', () => {
    const result = classifyEnvironment('ProdContosoCheckout', [
      rule({ pattern: '(?<App>Checkout)', attributes: { App: 'Billing' } }),
    ]);
    expect(result.attributes).toEqual({ App: 'Checkout' });
  });

  it('falls back to the forced value when the optional group did not participate', () => {
    const scoped = rule({ pattern: '^Prod(?<Scope>Front|Back)?$', attributes: { Scope: 'Back' } });
    expect(classifyEnvironment('ProdFront', [scoped]).attributes).toEqual({ Scope: 'Front' });
    expect(classifyEnvironment('Prod', [scoped]).attributes).toEqual({ Scope: 'Back' });
  });

  it('forces nothing when the pattern does not match', () => {
    const result = classifyEnvironment('PreprodContoso', [
      rule({ pattern: '^ProdContoso$', attributes: { App: 'Billing' } }),
    ]);
    expect(result.attributes).toEqual({});
  });

  it('ignores the attributes a meta rule forces, as it ignores its groups', () => {
    const result = classifyEnvironment('ProdContoso', [
      rule({ name: 'Production', pattern: '^Prod', kind: 'meta', attributes: { App: 'Billing' } }),
    ]);
    expect(result.attributes).toEqual({});
    expect(result.metaEnvironments).toEqual(['Production']);
  });

  describe('a rule confined to a repo', () => {
    const confined = rule({
      pattern: '^Prod$',
      repo: '^contoso-billing$',
      attributes: { Customer: 'Contoso', App: 'Billing' },
    });

    it('contributes when the context states a matching repo', () => {
      const result = classifyEnvironment('Prod', [confined], { repo: 'contoso-billing' });
      expect(result.attributes).toEqual({ Customer: 'Contoso', App: 'Billing' });
    });

    it('contributes nothing in another repo', () => {
      expect(classifyEnvironment('Prod', [confined], { repo: 'fabrikam-portal' }).attributes).toEqual(
        {},
      );
    });

    // The "if and only if" of it: an unstated repo is not a wildcard. This is
    // what keeps the dashboard, which folds a name across repos, from claiming
    // an attribute that holds in one repo only.
    it('contributes nothing when the repo is unknown', () => {
      expect(classifyEnvironment('Prod', [confined]).attributes).toEqual({});
      expect(classifyEnvironment('Prod', [confined], {}).attributes).toEqual({});
    });

    it('withholds its named groups too, not just its forced attributes', () => {
      const scoped = rule({ pattern: '^(?<Env>Prod)$', repo: '^contoso-' });
      expect(classifyEnvironment('Prod', [scoped]).attributes).toEqual({});
      expect(classifyEnvironment('Prod', [scoped], { repo: 'contoso-x' }).attributes).toEqual({
        Env: 'Prod',
      });
    });

    it('withholds its meta-environment outside the repo', () => {
      const scoped = rule({ name: 'Production', pattern: '^Prod$', kind: 'meta', repo: '^contoso-' });
      expect(classifyEnvironment('Prod', [scoped]).metaEnvironments).toEqual([]);
      expect(classifyEnvironment('Prod', [scoped], { repo: 'contoso-x' }).metaEnvironments).toEqual([
        'Production',
      ]);
    });

    it('stays silent on an unreadable repo pattern rather than applying to all', () => {
      const broken = rule({ pattern: '^Prod$', repo: '([', attributes: { App: 'Billing' } });
      expect(classifyEnvironment('Prod', [broken], { repo: 'anything' }).attributes).toEqual({});
    });
  });

  it('leaves a rule naming no repo applying everywhere, repo or not', () => {
    const free = rule({ pattern: '^(?<Env>Prod)$' });
    expect(classifyEnvironment('Prod', [free]).attributes).toEqual({ Env: 'Prod' });
    expect(classifyEnvironment('Prod', [free], { repo: 'any-repo' }).attributes).toEqual({
      Env: 'Prod',
    });
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
