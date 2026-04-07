/**
 * Which two dimensions the matrix crosses before anybody has chosen.
 *
 * The two that spread the data most — the opposite of what the board folds on.
 * Grouping wants the coarsest dimension because it shortens a long list;
 * a pivot wants the widest ones because an axis with a single value is a grid
 * one cell across, which says nothing a list would not have said better.
 *
 * Null below two dimensions: a grid needs two axes, and a rule set that
 * extracts one has nothing to cross. Saying so is better than drawing a column
 * of one and calling it a matrix.
 */
export function defaultAxes(
  dimensions: Record<string, string[]>,
): { rows: string; columns: string } | null {
  const usable = Object.keys(dimensions).filter((key) => dimensions[key].length > 0);
  if (usable.length < 2) return null;

  // Ties go to the API's own ordering, so the same data always crosses the
  // same way rather than flipping between two equally wide dimensions.
  const [rows, columns] = [...usable].sort(
    (a, b) => dimensions[b].length - dimensions[a].length || usable.indexOf(a) - usable.indexOf(b),
  );
  return { rows, columns };
}

/** A crossing, as both grids describe one. */
export interface Axes {
  rows: string;
  columns: string;
}

/**
 * The two axes every version reading carries, whatever the rules extract.
 *
 * They are not classification keys and never appear in `report.dimensions`:
 * a reading is filed against a repo and an environment name, which is what
 * makes them the only pair guaranteed to cross into a full grid.
 */
export const REPO_AXIS = 'repo';
export const ENVIRONMENT_AXIS = 'environment';

/**
 * What the version grid may cross: its two intrinsic axes, then whichever
 * classification keys have values to spread over.
 */
export function versionAxisKeys(dimensions: Record<string, string[]>): string[] {
  return [
    REPO_AXIS,
    ENVIRONMENT_AXIS,
    ...Object.keys(dimensions).filter((key) => dimensions[key].length > 0),
  ];
}

/**
 * The crossing the version grid starts from.
 *
 * Repo against environment, always — not the widest pair `defaultAxes` would
 * pick. This grid answers "which environment of this application is behind",
 * and that question *is* the crossing; spreading it over the two widest
 * dimensions would answer something else on a page nobody asked it of.
 */
export const DEFAULT_VERSION_AXES: Axes = { rows: REPO_AXIS, columns: ENVIRONMENT_AXIS };

/**
 * The crossing a direction actually renders.
 *
 * One pair travels in the address, and the two grids do not accept the same
 * keys — `repo` crosses here and means nothing to the instrument matrix. A
 * stored pair the current direction cannot honour therefore falls back to that
 * direction's own default instead of drawing an empty grid, which is what makes
 * walking from one direction to the other and back safe. The address is left
 * alone: the pair still belongs to the direction that wrote it, and rewriting
 * it on arrival would lose that reader's crossing for good.
 *
 * Crossing a key with itself is refused for the same reason it is refused in
 * the pickers: a grid one cell wide says nothing.
 */
export function resolveAxes(
  stored: Axes | undefined,
  available: readonly string[],
  fallback: Axes | null,
): Axes | null {
  if (
    stored &&
    stored.rows !== stored.columns &&
    available.includes(stored.rows) &&
    available.includes(stored.columns)
  ) {
    return stored;
  }
  return fallback;
}
