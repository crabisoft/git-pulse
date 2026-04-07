import { describe, expect, it } from 'vitest';
import type { EnvironmentVersion } from '@repo/shared';
import { compareReleases, judgeReadings, pivotVersions } from './releases';

function reading(over: Partial<EnvironmentVersion> = {}): EnvironmentVersion {
  return {
    repo: 'acme/api',
    environment: 'prod',
    version: '1.4.2',
    deploymentId: null,
    ref: null,
    ruleId: 'vr-1',
    url: null,
    status: 'ok',
    error: null,
    attributes: {},
    metaEnvironments: [],
    observedAt: '2026-08-02T08:00:00.000Z',
    changedAt: null,
    ...over,
  };
}

/** The judged form, which is what the pivot takes. */
function judge(versions: EnvironmentVersion[]) {
  return judgeReadings(versions);
}

describe('ordering two releases', () => {
  // The case a string comparison gets backwards, and the reason this is a
  // function rather than a `<`.
  it('compares segments as numbers', () => {
    expect(compareReleases('2.0.8', '2.1.0')).toBe(-1);
    expect(compareReleases('2.10.0', '2.9.0')).toBe(1);
  });

  it('treats a missing segment as zero', () => {
    expect(compareReleases('1.4', '1.4.0')).toBe(0);
    expect(compareReleases('1.4.1', '1.4')).toBe(1);
  });

  it('reads through the decoration around a release', () => {
    expect(compareReleases('v1.4.2', '1.4.2+build.87')).toBe(0);
    expect(compareReleases('release-1.4.1', 'v1.4.2')).toBe(-1);
  });

  // Not a tie: nothing at all can be said, and saying "behind" here would send
  // somebody investigating an incident that does not exist.
  it.each([
    ['1.4.2', 'main'],
    ['nightly', '1.4.2'],
    ['1.4.2', null],
    [null, null],
  ])('refuses to order %s against %s', (a, b) => {
    expect(compareReleases(a, b)).toBeNull();
  });
});

describe('judging a reading', () => {
  it('marks the environment behind the furthest release of its own repo', () => {
    const judged = judge([
      reading({ environment: 'dev', version: '2.1.0' }),
      reading({ environment: 'staging', version: '2.1.0' }),
      reading({ environment: 'prod', version: '2.0.8' }),
    ]);

    expect(judged.filter((j) => j.behind).map((j) => j.reading.environment)).toEqual(['prod']);
  });

  // Two repos version themselves independently: `api 1.5.0` beside
  // `web 2.1.0` says nothing at all.
  it('never compares one repo against another', () => {
    const judged = judge([
      reading({ repo: 'acme/api', version: '1.5.0' }),
      reading({ repo: 'acme/web', version: '2.1.0' }),
    ]);

    expect(judged.filter((j) => j.behind)).toEqual([]);
  });

  it('says nothing about a repo whose releases cannot be ordered', () => {
    const judged = judge([
      reading({ environment: 'dev', version: 'nightly' }),
      reading({ environment: 'prod', version: '2.0.8' }),
    ]);

    expect(judged.filter((j) => j.behind)).toEqual([]);
  });

  it('does not read a failed reading as a rollback', () => {
    // A version we failed to fetch is not a version that went backwards, so it
    // is neither the repo's furthest nor ever late.
    const judged = judge([
      reading({ environment: 'dev', version: '2.1.0' }),
      reading({ environment: 'prod', version: null, status: 'unreachable' }),
    ]);

    expect(judged.filter((j) => j.behind)).toEqual([]);
  });

  /**
   * The property the free axes rest on. `api` is late on staging; `web` runs a
   * lower number everywhere and is late nowhere. Cross the same readings four
   * ways and exactly the same reading is flagged each time — because the
   * judgement was made before any of them.
   */
  it('is the same fact whatever the grid is crossed on', () => {
    const versions = [
      reading({
        repo: 'acme/api',
        environment: 'prod',
        version: '2.1.0',
        attributes: { client: 'acme' },
      }),
      reading({
        repo: 'acme/api',
        environment: 'staging',
        version: '2.0.8',
        attributes: { client: 'acme' },
      }),
      reading({
        repo: 'acme/web',
        environment: 'prod',
        version: '1.0.0',
        attributes: { client: 'globex' },
      }),
    ];
    const judged = judge(versions);
    const late = judged
      .filter((j) => j.behind)
      .map((j) => `${j.reading.repo}/${j.reading.environment}`);
    expect(late).toEqual(['acme/api/staging']);

    for (const [rows, columns] of [
      ['repo', 'environment'],
      ['environment', 'repo'],
      ['client', 'environment'],
      ['client', 'repo'],
    ]) {
      const grid = pivotVersions(judged, rows, columns);
      const flagged = grid.cells
        .filter((cell) => cell.behind)
        .flatMap((cell) => cell.readings.filter((r) => r.behind))
        .map((r) => `${r.reading.repo}/${r.reading.environment}`);
      expect(flagged, `${rows} × ${columns}`).toEqual(['acme/api/staging']);
    }
  });
});

describe('the grid', () => {
  it('crosses repo against environment, both alphabetically', () => {
    const grid = pivotVersions(
      judge([
        reading({ repo: 'acme/web', environment: 'staging' }),
        reading({ repo: 'acme/api', environment: 'prod' }),
        reading({ repo: 'acme/api', environment: 'dev' }),
      ]),
      'repo',
      'environment',
    );

    expect(grid.rows).toEqual(['acme/api', 'acme/web']);
    // Alphabetical rather than pipeline order — nothing stored ranks an
    // environment — and stable across refreshes, which recency would not be.
    expect(grid.columns).toEqual(['dev', 'prod', 'staging']);
  });

  it('crosses a classification key, with the unclassified bucket last', () => {
    const grid = pivotVersions(
      judge([
        reading({ repo: 'acme/api', attributes: { client: 'globex' } }),
        reading({ repo: 'acme/web', attributes: {} }),
        reading({ repo: 'acme/jobs', attributes: { client: 'acme' } }),
      ]),
      'client',
      'environment',
    );

    expect(grid.rows).toEqual(['acme', 'globex', '']);
  });

  it('keeps a crossing nothing was read for, as a hole rather than a zero', () => {
    const grid = pivotVersions(
      judge([
        reading({ repo: 'acme/api', environment: 'prod' }),
        reading({ repo: 'acme/web', environment: 'dev' }),
      ]),
      'repo',
      'environment',
    );

    const missing = grid.cells.find((c) => c.row === 'acme/api' && c.column === 'dev');
    expect(missing?.readings).toEqual([]);
    expect(missing?.version).toBeNull();
    expect(missing?.mixed).toBe(false);
  });

  it('draws a grid one column wide rather than refusing an axis of one value', () => {
    const grid = pivotVersions(judge([reading()]), 'repo', 'environment');

    expect(grid.rows).toEqual(['acme/api']);
    expect(grid.columns).toEqual(['prod']);
    expect(grid.cells).toHaveLength(1);
  });

  it('folds every reading into the unclassified bucket of a dimension nothing carries', () => {
    // A key the rules extract for deployments but no environment of these
    // readings carries: one row, and it says so rather than rendering nothing.
    const grid = pivotVersions(
      judge([reading({ repo: 'acme/api' }), reading({ repo: 'acme/web' })]),
      'client',
      'environment',
    );

    expect(grid.rows).toEqual(['']);
    expect(grid.cells[0].readings).toHaveLength(2);
  });
});

describe('a cell folding several readings', () => {
  it('reports the release when they all state it', () => {
    const grid = pivotVersions(
      judge([
        reading({ repo: 'acme/api', attributes: { client: 'acme' } }),
        reading({ repo: 'acme/web', attributes: { client: 'acme' } }),
      ]),
      'client',
      'environment',
    );

    const cell = grid.cells[0];
    expect(cell.readings).toHaveLength(2);
    expect(cell.version).toBe('1.4.2');
    expect(cell.mixed).toBe(false);
  });

  it('reads two spellings of one release as agreement', () => {
    // `1.4.2` and `v1.4.2` are a naming convention, not a disagreement.
    const grid = pivotVersions(
      judge([
        reading({ repo: 'acme/api', version: '1.4.2', attributes: { client: 'acme' } }),
        reading({ repo: 'acme/web', version: 'v1.4.2', attributes: { client: 'acme' } }),
      ]),
      'client',
      'environment',
    );

    expect(grid.cells[0].mixed).toBe(false);
    expect(grid.cells[0].version).toBe('1.4.2');
  });

  it('names no version when they disagree', () => {
    const grid = pivotVersions(
      judge([
        reading({ repo: 'acme/api', version: '1.4.2', attributes: { client: 'acme' } }),
        reading({ repo: 'acme/web', version: '2.0.0', attributes: { client: 'acme' } }),
      ]),
      'client',
      'environment',
    );

    // Answering with either one would claim a set of environments runs a
    // release it does not agree on.
    expect(grid.cells[0].mixed).toBe(true);
    expect(grid.cells[0].version).toBeNull();
    expect(grid.cells[0].readings).toHaveLength(2);
  });

  it('does not let a failed reading look like a second opinion', () => {
    const grid = pivotVersions(
      judge([
        reading({ repo: 'acme/api', version: '1.4.2', attributes: { client: 'acme' } }),
        reading({
          repo: 'acme/web',
          version: null,
          status: 'unreachable',
          attributes: { client: 'acme' },
        }),
      ]),
      'client',
      'environment',
    );

    expect(grid.cells[0].mixed).toBe(false);
    expect(grid.cells[0].version).toBe('1.4.2');
  });
});
