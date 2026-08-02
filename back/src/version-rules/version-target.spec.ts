import { describe, expect, it } from 'vitest';
import {
  preferring,
  probeUrl,
  rulesFor,
  type ProbeSubject,
  type VersionRuleLike,
} from './version-target';

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

/** The address tried first, which is the one that decides the ordinary case. */
const first = (s: ProbeSubject, rules: VersionRuleLike[]) => rulesFor(s, rules)[0]?.id ?? null;

describe('rulesFor', () => {
  it('takes the rule whose environment pattern matches', () => {
    const prod = rule({ id: 'prod', environment: '^prod$' });
    const rec = rule({ id: 'rec', environment: '^rec$' });
    expect(first(subject(), [rec, prod])).toBe('prod');
  });

  it('lets a rule naming no environment answer for every one of them', () => {
    expect(first(subject({ environment: 'anything' }), [rule({ id: 'all' })])).toBe('all');
  });

  it('lets the lower priority number go first, whatever the declaration order', () => {
    const general = rule({ id: 'general', environment: 'prod', priority: 100 });
    const specific = rule({ id: 'specific', environment: '^prod$', priority: 10 });
    expect(first(subject(), [general, specific])).toBe('specific');
    expect(first(subject(), [specific, general])).toBe('specific');
  });

  it('keeps every rule that claims the environment, in the order to try them', () => {
    // One application may state its version at more than one address, and which
    // one it uses is a property of the environment. They are candidates in
    // turn, not contributors to one reading.
    const rules = [
      rule({ id: 'fallback', priority: 200 }),
      rule({ id: 'actuator', priority: 10 }),
      rule({ id: 'static', priority: 50 }),
    ];
    expect(rulesFor(subject(), rules).map((r) => r.id)).toEqual(['actuator', 'static', 'fallback']);
  });

  it('breaks a tie on declaration order rather than arbitrarily', () => {
    const rules = [rule({ id: 'a', priority: 10 }), rule({ id: 'b', priority: 10 })];
    expect(rulesFor(subject(), rules).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('leaves out the rules that do not claim the environment', () => {
    const rules = [rule({ id: 'prod', environment: '^prod$' }), rule({ id: 'rec', environment: '^rec$' })];
    expect(rulesFor(subject(), rules).map((r) => r.id)).toEqual(['prod']);
  });

  it('confines a rule to the repos its pattern matches', () => {
    const confined = rule({ id: 'billing', repo: '^billing$' });
    expect(first(subject({ repo: 'billing' }), [confined])).toBe('billing');
    expect(rulesFor(subject({ repo: 'portal' }), [confined])).toEqual([]);
  });

  it('answers with nothing when no rule matches', () => {
    expect(rulesFor(subject(), [rule({ environment: '^rec$' })])).toEqual([]);
  });

  it('keeps a repo-bound rule away from an environment that belongs to no repo', () => {
    // A declared environment — an appliance at a customer's site — is not every
    // repo, and testing a repo pattern against the empty string would let `.*`
    // claim exactly what it was confined away from.
    expect(rulesFor(subject({ repo: '' }), [rule({ repo: '.*' })])).toEqual([]);
    expect(first(subject({ repo: '' }), [rule()])).toBe('r1');
  });

  it('keeps an unreadable pattern silent rather than applying it everywhere', () => {
    expect(rulesFor(subject(), [rule({ environment: '([' })])).toEqual([]);
  });
});

describe('preferring', () => {
  const rules = [rule({ id: 'a' }), rule({ id: 'b' }), rule({ id: 'c' })];

  it('starts where the environment last answered', () => {
    // The saving the whole walk rests on: an environment whose third address
    // answers would otherwise pay the first two, each to its timeout, every
    // cycle for ever.
    expect(preferring(rules, 'c').map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps the others behind it, in the order they were already in', () => {
    expect(preferring(rules, 'b').map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('leaves the declared order alone when nothing has answered yet', () => {
    expect(preferring(rules, null).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves it alone when the rule that answered is gone', () => {
    // Deleted since, or no longer claiming this environment: the first read of
    // an environment and the read after a rule is removed are the same case.
    expect(preferring(rules, 'deleted').map((r) => r.id)).toEqual(['a', 'b', 'c']);
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
