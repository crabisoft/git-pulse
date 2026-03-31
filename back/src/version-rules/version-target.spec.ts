import { describe, expect, it } from 'vitest';
import { probeUrl, ruleFor, type ProbeSubject, type VersionRuleLike } from './version-target';

const rule = (over: Partial<VersionRuleLike> = {}): VersionRuleLike => ({
  id: 'r1',
  name: 'rule',
  urlTemplate: 'https://example.com/version',
  priority: 100,
  ...over,
});

const subject = (over: Partial<ProbeSubject> = {}): ProbeSubject => ({
  repo: 'billing',
  environment: 'prod',
  ...over,
});

describe('ruleFor', () => {
  it('takes the rule whose environment pattern matches', () => {
    const prod = rule({ id: 'prod', environment: '^prod$' });
    const rec = rule({ id: 'rec', environment: '^rec$' });
    expect(ruleFor(subject(), [rec, prod])?.id).toBe('prod');
  });

  it('lets a rule naming no environment answer for every one of them', () => {
    expect(ruleFor(subject({ environment: 'anything' }), [rule({ id: 'all' })])?.id).toBe('all');
  });

  it('lets the lower priority number win, whatever the declaration order', () => {
    const general = rule({ id: 'general', environment: 'prod', priority: 100 });
    const specific = rule({ id: 'specific', environment: '^prod$', priority: 10 });
    expect(ruleFor(subject(), [general, specific])?.id).toBe('specific');
    expect(ruleFor(subject(), [specific, general])?.id).toBe('specific');
  });

  it('selects one rule where classification accumulates several', () => {
    // A version is a single reading: two rules cannot each contribute a piece
    // of it, so the most specific has to win outright.
    const rules = [rule({ id: 'a', priority: 10 }), rule({ id: 'b', priority: 20 })];
    expect(ruleFor(subject(), rules)?.id).toBe('a');
  });

  it('confines a rule to the repos its pattern matches', () => {
    const confined = rule({ id: 'billing', repo: '^billing$' });
    expect(ruleFor(subject({ repo: 'billing' }), [confined])?.id).toBe('billing');
    expect(ruleFor(subject({ repo: 'portal' }), [confined])).toBeNull();
  });

  it('answers with nothing when no rule matches', () => {
    expect(ruleFor(subject(), [rule({ environment: '^rec$' })])).toBeNull();
  });

  it('keeps an unreadable pattern silent rather than applying it everywhere', () => {
    expect(ruleFor(subject(), [rule({ environment: '([' })])).toBeNull();
  });
});

describe('probeUrl', () => {
  it('builds on the address the platform published', () => {
    const target = probeUrl(
      rule({ urlTemplate: '{environmentUrl}/actuator/info' }),
      subject({ environmentUrl: 'https://billing.example.com' }),
    );
    expect(target).toEqual({ ok: true, url: 'https://billing.example.com/actuator/info' });
  });

  it('does not double the slash between the address and the path', () => {
    const target = probeUrl(
      rule({ urlTemplate: '{environmentUrl}/actuator/info' }),
      subject({ environmentUrl: 'https://billing.example.com/' }),
    );
    expect(target).toMatchObject({ url: 'https://billing.example.com/actuator/info' });
  });

  it('builds on the classification when the platform published nothing', () => {
    // The common case, which is why the feature cannot rest on the platform's
    // address alone: neither host states one unless an environment was
    // configured with an external URL.
    const target = probeUrl(
      rule({ urlTemplate: 'https://{attr.client}.example.com/{repo}/version' }),
      subject({ attributes: { client: 'contoso' } }),
    );
    expect(target).toMatchObject({ url: 'https://contoso.example.com/billing/version' });
  });

  it('resolves the environment and the deployed ref', () => {
    const target = probeUrl(
      rule({ urlTemplate: 'https://x.example.com/{environment}?ref={ref}' }),
      subject({ ref: 'v1.4.2' }),
    );
    expect(target).toMatchObject({ url: 'https://x.example.com/prod?ref=v1.4.2' });
  });

  it('stays silent when the platform published no address', () => {
    // Not an error: a rule addressing `{environmentUrl}` has nothing to say
    // about an environment whose platform states none, and one connection
    // attempt against `undefined/actuator/info` per deployment is worse than
    // saying so.
    const target = probeUrl(rule({ urlTemplate: '{environmentUrl}/info' }), subject());
    expect(target).toEqual({ ok: false, reason: { code: 'errors.version.noEnvironmentUrl' } });
  });

  it('treats an empty address as no address', () => {
    const target = probeUrl(
      rule({ urlTemplate: '{environmentUrl}/info' }),
      subject({ environmentUrl: '' }),
    );
    expect(target).toMatchObject({ reason: { code: 'errors.version.noEnvironmentUrl' } });
  });

  it('names the attribute a classification rule did not produce', () => {
    const target = probeUrl(
      rule({ urlTemplate: 'https://{attr.client}.example.com/version' }),
      subject(),
    );
    expect(target).toEqual({
      ok: false,
      reason: { code: 'errors.version.noAttribute', params: { key: 'client' } },
    });
  });

  it('names a placeholder that resolves to nothing at all', () => {
    // A typo in the rule being written, told apart from the two above because
    // it is fixed in the rule and not in the data.
    const target = probeUrl(rule({ urlTemplate: 'https://x/{nope}' }), subject());
    expect(target).toEqual({
      ok: false,
      reason: { code: 'errors.version.unknownPlaceholder', params: { name: 'nope' } },
    });
  });

  it('reports the first unresolved placeholder and stops there', () => {
    const target = probeUrl(
      rule({ urlTemplate: '{environmentUrl}/{attr.client}' }),
      subject(),
    );
    expect(target).toMatchObject({ reason: { code: 'errors.version.noEnvironmentUrl' } });
  });

  it('leaves a template holding no placeholder alone', () => {
    expect(probeUrl(rule(), subject())).toEqual({ ok: true, url: 'https://example.com/version' });
  });

  it('interpolates a repo path without escaping the slashes that structure it', () => {
    const target = probeUrl(
      rule({ urlTemplate: 'https://x.example.com/{repo}/version' }),
      subject({ repo: 'group/sub/project' }),
    );
    expect(target).toMatchObject({ url: 'https://x.example.com/group/sub/project/version' });
  });
});
