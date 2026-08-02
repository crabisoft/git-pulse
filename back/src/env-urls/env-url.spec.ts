import { describe, expect, it } from 'vitest';
import {
  declarationFor,
  environmentUrlFor,
  resolveEnvUrl,
  ruleFor,
  type AddressSubject,
  type EnvUrlRuleLike,
  type ManualEnvironmentLike,
} from './env-url';

const rule = (over: Partial<EnvUrlRuleLike> = {}): EnvUrlRuleLike => ({
  name: 'rule',
  pattern: '.*',
  urlTemplate: 'https://example.test',
  mode: 'fill',
  priority: 100,
  ...over,
});

const declared = (over: Partial<ManualEnvironmentLike> = {}): ManualEnvironmentLike => ({
  repo: '',
  environment: 'prod',
  url: 'https://declared.test',
  mode: 'fill',
  ...over,
});

const subject = (over: Partial<AddressSubject> = {}): AddressSubject => ({
  repo: 'portal-api',
  environment: 'acme-prod',
  ...over,
});

describe('environmentUrlFor', () => {
  it('addresses an environment the platform published nothing for', () => {
    const url = environmentUrlFor(subject(), [
      rule({ pattern: '^(?<client>\\w+)-prod$', urlTemplate: 'https://{client}.example.test' }),
    ]);
    expect(url).toBe('https://acme.example.test');
  });

  it('leaves a published address alone by default', () => {
    const url = environmentUrlFor(
      subject({ environmentUrl: 'https://published.test' }),
      [rule({ urlTemplate: 'https://derived.test' })],
    );
    expect(url).toBe('https://published.test');
  });

  it('replaces a published address when the rule says to', () => {
    const url = environmentUrlFor(subject({ environmentUrl: 'https://internal.lan' }), [
      rule({ mode: 'overwrite', urlTemplate: 'https://derived.test' }),
    ]);
    expect(url).toBe('https://derived.test');
  });

  it('answers null when nothing published an address and no rule applies', () => {
    expect(environmentUrlFor(subject(), [rule({ pattern: '^staging$' })])).toBeNull();
  });

  it('resolves the fixed names beside the pattern groups', () => {
    const url = environmentUrlFor(
      subject({ ref: 'v1.4.2', attributes: { client: 'acme' } }),
      [
        rule({
          pattern: '^\\w+-(?<tier>prod|rec)$',
          urlTemplate: 'https://{attr.client}.example.test/{repo}/{tier}?ref={ref}',
        }),
      ],
    );
    expect(url).toBe('https://acme.example.test/portal-api/prod?ref=v1.4.2');
  });

  it('lets a captured group outrank the fixed name it shadows', () => {
    const url = environmentUrlFor(subject(), [
      rule({ pattern: '^(?<environment>\\w+)-prod$', urlTemplate: 'https://{environment}.test' }),
    ]);
    expect(url).toBe('https://acme.test');
  });

  it('keeps the published address when a placeholder resolves to nothing', () => {
    // A hole in a URL is not an address, and a rule that cannot fill one has
    // nothing to say about this environment — which is a normal outcome.
    const url = environmentUrlFor(subject({ environmentUrl: 'https://published.test' }), [
      rule({ mode: 'overwrite', urlTemplate: 'https://{attr.client}.example.test' }),
    ]);
    expect(url).toBe('https://published.test');
  });

  it('answers null rather than a half-rendered address', () => {
    expect(
      environmentUrlFor(subject(), [rule({ urlTemplate: 'https://{attr.client}.example.test' })]),
    ).toBeNull();
  });

  it('prefers a declaration to a rule', () => {
    const url = environmentUrlFor(
      subject({ environment: 'prod' }),
      [rule({ urlTemplate: 'https://derived.test' })],
      [declared({ url: 'https://spelled-out.test' })],
    );
    expect(url).toBe('https://spelled-out.test');
  });

  it('leaves a published address alone for a declaration that only fills', () => {
    const url = environmentUrlFor(
      subject({ environment: 'prod', environmentUrl: 'https://published.test' }),
      [],
      [declared()],
    );
    expect(url).toBe('https://published.test');
  });

  it('falls through to the rules for a declaration that states no address', () => {
    const url = environmentUrlFor(
      subject({ environment: 'prod' }),
      [rule({ urlTemplate: 'https://derived.test' })],
      [declared({ url: null })],
    );
    expect(url).toBe('https://derived.test');
  });
});

describe('ruleFor', () => {
  it('selects the lowest priority number, whatever the declaration order', () => {
    const rules = [
      rule({ name: 'broad', pattern: 'prod', priority: 50 }),
      rule({ name: 'narrow', pattern: '^acme-prod$', priority: 10 }),
    ];
    expect(ruleFor(subject(), rules)?.name).toBe('narrow');
    expect(ruleFor(subject(), [...rules].reverse())?.name).toBe('narrow');
  });

  it('confines a rule to the repo it names', () => {
    const confined = [rule({ repo: '^portal-' })];
    expect(ruleFor(subject(), confined)).not.toBeNull();
    expect(ruleFor(subject({ repo: 'billing-api' }), confined)).toBeNull();
  });

  it('keeps a repo-bound rule away from an environment that belongs to no repo', () => {
    // An appliance at a customer's site is not every repo, so a rule confined to
    // one must not answer for it — which a bare pattern test would let happen.
    expect(ruleFor(subject({ repo: '' }), [rule({ repo: '.*' })])).toBeNull();
  });

  it('stays silent on an unreadable pattern', () => {
    expect(ruleFor(subject(), [rule({ pattern: '(' })])).toBeNull();
    expect(ruleFor(subject(), [rule({ repo: '(' })])).toBeNull();
  });
});

describe('declarationFor', () => {
  it('prefers the declaration bound to the repo', () => {
    const entries = [
      declared({ repo: '', url: 'https://anywhere.test' }),
      declared({ repo: 'portal-api', url: 'https://portal.test' }),
    ];
    expect(declarationFor(subject({ environment: 'prod' }), entries)?.url).toBe(
      'https://portal.test',
    );
  });

  it('lets a declaration bound to no repo answer wherever the name turns up', () => {
    const entries = [declared({ repo: '' })];
    expect(declarationFor(subject({ environment: 'prod', repo: 'billing-api' }), entries)?.url).toBe(
      'https://declared.test',
    );
  });

  it('never lets a repo-bound declaration answer for another repo', () => {
    const entries = [declared({ repo: 'portal-api' })];
    expect(declarationFor(subject({ environment: 'prod', repo: 'billing-api' }), entries)).toBeUndefined();
  });
});

/**
 * The same answers, with what produced them.
 *
 * An absent address has two causes that look identical on a page and want
 * opposite fixes, and telling them apart is the whole of what somebody writing
 * a rule needs from a preview.
 */
describe('resolveEnvUrl', () => {
  it('names the rule that answered', () => {
    const answer = resolveEnvUrl(subject(), [
      rule({
        name: 'Client host',
        pattern: '^(?<client>\\w+)-prod$',
        urlTemplate: 'https://{client}.example.test',
      }),
    ]);
    expect(answer).toEqual({
      url: 'https://acme.example.test',
      rule: 'Client host',
      declared: false,
      unresolved: null,
    });
  });

  it('names the placeholder that kept a matching rule silent', () => {
    // A pattern capturing `(?<Customer>…)` against a template asking for
    // `{customer}`: the rule matched, and nothing came out. Reported as "no
    // rule addresses this environment", it sends the author back to a pattern
    // that was never wrong.
    const answer = resolveEnvUrl(subject({ environment: 'PreprodParefExtranetBack' }), [
      rule({
        name: 'Extranet preprod',
        pattern: 'Preprod(?<Customer>[a-zA-Z-]+)ExtranetBack',
        urlTemplate: 'https://api.{customer}.example.test',
      }),
    ]);
    expect(answer).toMatchObject({ url: null, rule: 'Extranet preprod', unresolved: 'customer' });
  });

  it('names the first unresolved placeholder, a template being fixed one at a time', () => {
    const answer = resolveEnvUrl(subject(), [
      rule({ urlTemplate: 'https://{attr.client}.example.test/{attr.tier}' }),
    ]);
    expect(answer.unresolved).toBe('attr.client');
  });

  it('names no rule when none claimed the environment', () => {
    // The other cause of an absent address, and the only one a pattern fixes.
    const answer = resolveEnvUrl(subject(), [rule({ pattern: '^nothing$' })]);
    expect(answer).toEqual({ url: null, rule: null, declared: false, unresolved: null });
  });

  it('names the rule that claimed the environment and stood down', () => {
    // `fill` against a platform that published something. That the rule matched
    // at all is the thing an author cannot otherwise tell.
    const answer = resolveEnvUrl(
      subject({ environmentUrl: 'https://published.test' }),
      [rule({ name: 'Client host', urlTemplate: 'https://ours.test' })],
    );
    expect(answer).toMatchObject({ url: 'https://published.test', rule: 'Client host' });
  });

  it('says when a declaration by hand answered, which no rule outranks', () => {
    const answer = resolveEnvUrl(subject({ environment: 'prod' }), [rule()], [declared()]);
    expect(answer).toEqual({
      url: 'https://declared.test',
      rule: null,
      declared: true,
      unresolved: null,
    });
  });
});
