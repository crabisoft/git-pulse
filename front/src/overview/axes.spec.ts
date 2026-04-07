import { describe, expect, it } from 'vitest';
import { DEFAULT_VERSION_AXES, defaultAxes, resolveAxes, versionAxisKeys } from './axes';

const DIMENSIONS = { client: ['acme', 'globex'], app: ['api', 'web'], empty: [] as string[] };

describe('what each grid may cross', () => {
  it('offers the version grid its two intrinsic axes before any dimension', () => {
    expect(versionAxisKeys(DIMENSIONS)).toEqual(['repo', 'environment', 'client', 'app']);
  });

  it('leaves out a dimension no environment carries a value for', () => {
    // An axis with no values is a grid one cell across, which says nothing.
    expect(versionAxisKeys(DIMENSIONS)).not.toContain('empty');
  });

  it('offers the version grid a crossing even with no rules at all', () => {
    // Every reading carries a repo and an environment, so this grid always has
    // something to draw — unlike the matrix, which needs two dimensions.
    expect(versionAxisKeys({})).toEqual(['repo', 'environment']);
    expect(defaultAxes({})).toBeNull();
  });
});

describe('resolving the crossing a direction renders', () => {
  it('keeps a stored pair the direction can honour', () => {
    const stored = { rows: 'client', columns: 'environment' };

    expect(resolveAxes(stored, versionAxisKeys(DIMENSIONS), DEFAULT_VERSION_AXES)).toEqual(stored);
  });

  // The crossing that made this a per-direction question: `repo` is an axis of
  // the version grid and means nothing to the instrument matrix.
  it('falls back when the stored pair belongs to another direction', () => {
    const stored = { rows: 'repo', columns: 'environment' };

    expect(resolveAxes(stored, Object.keys(DIMENSIONS), defaultAxes(DIMENSIONS))).toEqual(
      defaultAxes(DIMENSIONS),
    );
  });

  it('walks between the two directions without breaking either', () => {
    const matrixKeys = Object.keys(DIMENSIONS);
    const versionKeys = versionAxisKeys(DIMENSIONS);

    // Chosen on the matrix, then read by the version grid: valid for both.
    const onMatrix = { rows: 'client', columns: 'app' };
    expect(resolveAxes(onMatrix, versionKeys, DEFAULT_VERSION_AXES)).toEqual(onMatrix);

    // Chosen on the version grid, then read by the matrix: it steps back to
    // its own default rather than rendering an empty grid.
    const onVersions = { rows: 'repo', columns: 'client' };
    expect(resolveAxes(onVersions, matrixKeys, defaultAxes(DIMENSIONS))).toEqual(
      defaultAxes(DIMENSIONS),
    );
    // And coming back, the version grid still honours what it was given.
    expect(resolveAxes(onVersions, versionKeys, DEFAULT_VERSION_AXES)).toEqual(onVersions);
  });

  it('refuses a key crossed with itself', () => {
    const stored = { rows: 'client', columns: 'client' };

    expect(resolveAxes(stored, versionAxisKeys(DIMENSIONS), DEFAULT_VERSION_AXES)).toEqual(
      DEFAULT_VERSION_AXES,
    );
  });

  it('falls back when a dimension has gone from the report', () => {
    // A pair stored while the rules extracted more than they do now.
    const stored = { rows: 'client', columns: 'gone' };

    expect(resolveAxes(stored, versionAxisKeys(DIMENSIONS), DEFAULT_VERSION_AXES)).toEqual(
      DEFAULT_VERSION_AXES,
    );
  });

  it('proposes repo against environment when nobody has chosen', () => {
    expect(resolveAxes(undefined, versionAxisKeys(DIMENSIONS), DEFAULT_VERSION_AXES)).toEqual({
      rows: 'repo',
      columns: 'environment',
    });
  });
});
