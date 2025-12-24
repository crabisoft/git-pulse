import { describe, expect, it } from 'vitest';
import { scopeFromSelection, scopeTracks } from '@repo/shared';
import { applyScope } from './scope.util';

const REPOS = ['api', 'web', 'legacy'];

describe('applyScope', () => {
  it('keeps everything when nothing is stated', () => {
    expect(applyScope(REPOS, { owner: 'acme' })).toEqual(REPOS);
  });

  it('reads a scope written before trackNewRepos existed as it always read', () => {
    expect(applyScope(REPOS, { owner: 'acme', include: ['api'] })).toEqual(['api']);
    expect(applyScope(REPOS, { owner: 'acme', exclude: ['legacy'] })).toEqual(['api', 'web']);
  });

  it('tracks what is not excluded once new repos are followed', () => {
    const scope = { owner: 'acme', include: [], exclude: ['legacy'], trackNewRepos: true };
    expect(applyScope([...REPOS, 'mobile'], scope)).toEqual(['api', 'web', 'mobile']);
  });

  it('tracks only what is named once new repos are not followed', () => {
    const scope = { owner: 'acme', include: ['api', 'web'], exclude: [], trackNewRepos: false };
    expect(applyScope([...REPOS, 'mobile'], scope)).toEqual(['api', 'web']);
  });

  it('lets an exclusion win over an inclusion naming the same repo', () => {
    expect(scopeTracks({ owner: 'acme', include: ['api'], exclude: ['api'] }, 'api')).toBe(false);
  });
});

describe('scopeFromSelection', () => {
  const selection = new Set(['api', 'web']);

  it('gives the selection back unchanged, whichever side it wrote down', () => {
    for (const trackNewRepos of [true, false]) {
      const scope = { owner: 'acme', ...scopeFromSelection(REPOS, selection, trackNewRepos) };
      expect(applyScope(REPOS, scope)).toEqual(['api', 'web']);
    }
  });

  it('stores the exclusions when new repos are followed, the inclusions otherwise', () => {
    expect(scopeFromSelection(REPOS, selection, true)).toEqual({
      include: [],
      exclude: ['legacy'],
      trackNewRepos: true,
    });
    expect(scopeFromSelection(REPOS, selection, false)).toEqual({
      include: ['api', 'web'],
      exclude: [],
      trackNewRepos: false,
    });
  });

  it('drops a selection that is empty of everything, rather than reading it as all', () => {
    const scope = { owner: 'acme', ...scopeFromSelection(REPOS, new Set<string>(), false) };
    expect(applyScope(REPOS, scope)).toEqual([]);
  });
});
