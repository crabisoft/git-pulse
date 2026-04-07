import { describe, expect, it } from 'vitest';
import { agreesWithRef, newestPerEnvironment, readingAge, releaseIn } from './versions';

describe('the release a string states', () => {
  it.each([
    ['v1.4.2', '1.4.2'],
    ['release-1.4.2', '1.4.2'],
    ['1.4.2-rc1', '1.4.2'],
    ['1.4.2+build.87', '1.4.2'],
    ['1.4.2-87', '1.4.2'],
  ])('reads %s as %s', (text, expected) => {
    expect(releaseIn(text)).toBe(expected);
  });

  it.each(['main', 'feature/login', '9f3c1ab', 'build-87', ''])('states none in %s', (text) => {
    expect(releaseIn(text)).toBeNull();
  });

  it('states none in nothing at all', () => {
    expect(releaseIn(null)).toBeNull();
  });
});

describe('agreement with the deployed ref', () => {
  it('matches across spellings of the same release', () => {
    expect(agreesWithRef('1.4.2', 'v1.4.2')).toBe('match');
    expect(agreesWithRef('1.4.2+build.87', 'release-1.4.2')).toBe('match');
  });

  it('reports the gap the feature exists for', () => {
    expect(agreesWithRef('1.4.1', 'v1.4.2')).toBe('differs');
  });

  // A branch or a sha states no release, and a guess there would read as a
  // failed deployment on a page where that means an incident.
  it.each([
    ['1.4.2', 'main'],
    ['1.4.2', '9f3c1ab'],
    [null, 'v1.4.2'],
  ])('says nothing when %s cannot be compared to %s', (version, ref) => {
    expect(agreesWithRef(version, ref)).toBe('unknown');
  });
});

describe('the age of a reading', () => {
  const now = Date.parse('2026-08-01T12:00:00.000Z');

  it.each([
    ['2026-08-01T11:58:00.000Z', 'minute', 2],
    ['2026-08-01T09:00:00.000Z', 'hour', 3],
    ['2026-07-29T12:00:00.000Z', 'day', 3],
  ])('reads %s as %s', (observedAt, unit, count) => {
    expect(readingAge(observedAt, now)).toEqual({ unit, count });
  });

  // A reading taken by a machine whose clock runs ahead is not "in -2 minutes".
  it('never reports a reading from the future', () => {
    expect(readingAge('2026-08-01T12:05:00.000Z', now)).toEqual({ unit: 'minute', count: 0 });
  });
});

describe('which rows may show what the environment runs now', () => {
  const row = (id: string, environment: string, createdAt: string, repo = 'acme/api') => ({
    id,
    repo,
    environment,
    createdAt,
  });

  it('picks the newest deployment of each environment', () => {
    const newest = newestPerEnvironment([
      row('old', 'prod', '2026-07-30T10:00:00.000Z'),
      row('new', 'prod', '2026-08-01T09:00:00.000Z'),
      row('staging', 'staging', '2026-07-20T09:00:00.000Z'),
    ]);

    // The superseded one is excluded, and that is the point: what the
    // environment answers today is the newer deployment's doing, and saying so
    // on the older row would be plainly false.
    expect([...newest].sort()).toEqual(['new', 'staging']);
  });

  it('keeps one environment name in two repos apart', () => {
    const newest = newestPerEnvironment([
      row('api', 'prod', '2026-08-01T09:00:00.000Z', 'acme/api'),
      row('web', 'prod', '2026-08-01T08:00:00.000Z', 'acme/web'),
    ]);

    expect([...newest].sort()).toEqual(['api', 'web']);
  });

  it('has nothing to offer an empty list', () => {
    expect(newestPerEnvironment([]).size).toBe(0);
  });
});
