import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListEnvRulesDto } from './list-env-rules.dto';
import { CreateEnvRuleDto } from './create-env-rule.dto';
import { UpdateEnvRuleDto } from './update-env-rule.dto';
import { ClassifyNameDto } from './classify-name.dto';

/**
 * Mirrors the global pipe: `transform` so the decorators run, and
 * `forbidNonWhitelisted` so an undeclared property is a rejection rather than a
 * silently dropped one — which is how it behaves in production.
 */
function reject<T extends object>(Dto: new () => T, payload: unknown): string[] {
  const errors = validateSync(plainToInstance(Dto, payload) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('rule target validation', () => {
  // The regression this suite exists for: `incident` was added to RuleTarget
  // but not to the DTOs, so every request carrying it answered 400 — including
  // the catalogue read the source form makes, which came back empty.
  it.each(['environment', 'repository', 'incident'])('accepts the %s target', (target) => {
    expect(reject(ListEnvRulesDto, { target })).toEqual([]);
    expect(reject(ClassifyNameDto, { name: 'prod', target })).toEqual([]);
    expect(reject(CreateEnvRuleDto, { name: 'r', pattern: '.*', kind: 'simple', target })).toEqual(
      [],
    );
  });

  it('rejects a target no rule can be matched against', () => {
    expect(reject(ListEnvRulesDto, { target: 'deployment' })).toEqual(['target']);
  });

  it('treats an omitted target as valid, the controller defaulting it', () => {
    expect(reject(ListEnvRulesDto, {})).toEqual([]);
  });
});

describe('ListEnvRulesDto', () => {
  it('accepts a page window within the cap', () => {
    expect(reject(ListEnvRulesDto, { limit: 200, offset: 20 })).toEqual([]);
  });

  it('rejects a page size beyond PAGE_LIMIT_MAX', () => {
    expect(reject(ListEnvRulesDto, { limit: 201 })).toEqual(['limit']);
  });

  it('rejects a negative offset', () => {
    expect(reject(ListEnvRulesDto, { offset: -1 })).toEqual(['offset']);
  });

  it('rejects a property no route declares', () => {
    expect(reject(ListEnvRulesDto, { sourceId: 'abc' })).toEqual(['sourceId']);
  });
});

describe('CreateEnvRuleDto', () => {
  it('accepts the minimum a rule needs', () => {
    expect(reject(CreateEnvRuleDto, { name: 'Prod', pattern: '^prod', kind: 'meta' })).toEqual([]);
  });

  it('rejects an empty name or pattern', () => {
    expect(reject(CreateEnvRuleDto, { name: '', pattern: '.*', kind: 'simple' })).toEqual(['name']);
    expect(reject(CreateEnvRuleDto, { name: 'r', pattern: '', kind: 'simple' })).toEqual([
      'pattern',
    ]);
  });

  it('rejects a kind that is neither simple nor meta', () => {
    expect(reject(CreateEnvRuleDto, { name: 'r', pattern: '.*', kind: 'regex' })).toEqual(['kind']);
  });

  it('rejects a negative priority', () => {
    expect(
      reject(CreateEnvRuleDto, { name: 'r', pattern: '.*', kind: 'simple', priority: -1 }),
    ).toEqual(['priority']);
  });
});

describe('forced attributes', () => {
  const withAttributes = (attributes: unknown) => ({
    name: 'r',
    pattern: '^Prod',
    kind: 'simple',
    attributes,
  });

  it('accepts a map of name-shaped keys to non-empty strings', () => {
    expect(reject(CreateEnvRuleDto, withAttributes({ App: 'Billing' }))).toEqual([]);
    expect(reject(UpdateEnvRuleDto, { attributes: {} })).toEqual([]);
  });

  it('rejects a key no named group could carry', () => {
    // Downstream a forced attribute and a captured one are the same thing, so
    // they answer to the same key shape.
    expect(reject(CreateEnvRuleDto, withAttributes({ 'my app': 'Billing' }))).toEqual([
      'attributes',
    ]);
    expect(reject(CreateEnvRuleDto, withAttributes({ '1st': 'Billing' }))).toEqual([
      'attributes',
    ]);
  });

  it('rejects a value that is not a non-empty string', () => {
    expect(reject(CreateEnvRuleDto, withAttributes({ App: '' }))).toEqual(['attributes']);
    expect(reject(CreateEnvRuleDto, withAttributes({ App: 3 }))).toEqual(['attributes']);
    expect(reject(CreateEnvRuleDto, withAttributes({ App: { name: 'x' } }))).toEqual(['attributes']);
  });

  it('rejects anything that is not a flat map', () => {
    expect(reject(CreateEnvRuleDto, withAttributes(['App=Billing']))).toEqual(['attributes']);
    expect(reject(CreateEnvRuleDto, withAttributes('App=Billing'))).toEqual(['attributes']);
  });
});
