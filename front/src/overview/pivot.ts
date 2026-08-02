import type { DashboardEnvironment } from '@repo/shared';
import { UNCLASSIFIED } from './grouping';

export interface PivotCell {
  row: string;
  column: string;
  /** Null where the crossing does not exist — no such environment. */
  environment: DashboardEnvironment | null;
  /**
   * The others sharing the crossing, most recently deployed first.
   *
   * A grid crosses two dimensions; rules that extract four leave the other two
   * collapsed, and several environments land on one cell. The cell still
   * reports what is running there now — but it has to say how many it is not
   * showing, or picking one pair of axes silently hides half the estate.
   */
  others: DashboardEnvironment[];
}

export interface Pivot {
  rows: string[];
  columns: string[];
  cells: PivotCell[];
}

/**
 * Two dimensions crossed into a grid.
 *
 * With rules that extract a client and an app, the interesting question is
 * rarely about one environment — it is "who is behind". A list answers that by
 * being read line by line; a grid answers it by shape: a column where one row
 * carries an older ref than its neighbours is visible before anything is read.
 *
 * A crossing with no environment is kept as an empty cell rather than dropped,
 * because "this client has no jobs environment" is itself an answer, and a
 * grid with holes punched out of it stops being alignable.
 *
 * More than one environment on a crossing is possible — two prod environments
 * for the same client and app, or any pair of axes that leaves a third
 * dimension collapsed. The most recently deployed one wins the cell, because
 * it reports what is running there now; the rest travel with it, so the cell
 * can say what it is standing in front of.
 */
export function pivotEnvironments(
  environments: DashboardEnvironment[],
  rowKey: string,
  columnKey: string,
): Pivot {
  const rows = distinct(environments, rowKey);
  const columns = distinct(environments, columnKey);

  const byCrossing = new Map<string, DashboardEnvironment[]>();
  for (const env of environments) {
    const crossing = `${valueOf(env, rowKey)}\u0000${valueOf(env, columnKey)}`;
    const held = byCrossing.get(crossing);
    if (held) held.push(env);
    else byCrossing.set(crossing, [env]);
  }
  // Sorted once per crossing rather than compared one by one: the cell needs
  // the whole order, not just its head. A declared environment sorts last —
  // the cell shows the head as what runs at that crossing, and one that was
  // deployed to says more about it than one that never was.
  for (const held of byCrossing.values()) {
    held.sort((a, b) => {
      if (a.lastDeployAt === null || b.lastDeployAt === null) {
        return (a.lastDeployAt === null ? 1 : 0) - (b.lastDeployAt === null ? 1 : 0);
      }
      return msOf(b.lastDeployAt) - msOf(a.lastDeployAt);
    });
  }

  const cells = rows.flatMap((row) =>
    columns.map((column) => {
      const [running = null, ...others] = byCrossing.get(`${row}\u0000${column}`) ?? [];
      return { row, column, environment: running, others };
    }),
  );

  return { rows, columns, cells };
}

/** Values seen for a key, alphabetically, with the unclassified bucket last. */
function distinct(environments: DashboardEnvironment[], key: string): string[] {
  const values = [...new Set(environments.map((env) => valueOf(env, key)))];
  return values.sort((a, b) => {
    if (a === UNCLASSIFIED) return 1;
    if (b === UNCLASSIFIED) return -1;
    return a.localeCompare(b);
  });
}

function valueOf(env: DashboardEnvironment, key: string): string {
  return env.attributes[key] ?? UNCLASSIFIED;
}

function msOf(date: string): number {
  return new Date(date).getTime();
}
