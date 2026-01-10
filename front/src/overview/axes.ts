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
