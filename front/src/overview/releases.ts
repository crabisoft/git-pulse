import type { EnvironmentVersion } from '@repo/shared';
import { releaseIn } from '../versions';
import { UNCLASSIFIED } from './grouping';
import { ENVIRONMENT_AXIS, REPO_AXIS } from './axes';

/**
 * Two releases ordered, or `null` when they cannot be.
 *
 * Segments are compared as numbers rather than as text — `2.0.8` is behind
 * `2.1.0`, which a string comparison gets backwards — and a missing segment
 * counts as zero, so `1.4` and `1.4.0` are the same release.
 *
 * Null is not a tie. Either side stating no release at all — a build counter, a
 * commit sha, an environment that answered a word — makes the pair
 * incomparable, and the caller must say nothing rather than pick an order. It
 * is the same stance `agreesWithRef` takes: telling somebody an environment is
 * behind when it is merely unreadable sends them investigating an incident that
 * does not exist.
 */
export function compareReleases(a: string | null, b: string | null): number | null {
  const left = releaseIn(a);
  const right = releaseIn(b);
  if (!left || !right) return null;

  const ours = left.split('.').map(Number);
  const theirs = right.split('.').map(Number);
  for (let i = 0; i < Math.max(ours.length, theirs.length); i += 1) {
    const diff = (ours[i] ?? 0) - (theirs[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** A reading and what can be said about it before anything is laid out. */
export interface JudgedReading {
  reading: EnvironmentVersion;
  /**
   * True when this environment is not on the furthest release its **own repo**
   * runs anywhere.
   *
   * A property of the reading, decided before any grid exists, and that is the
   * whole point: lateness is a fact about a repo's environments, not about
   * whichever cell a chosen pair of axes drops this reading into. Judged per
   * displayed row instead, a grid keyed on `client` would compare `api 1.5.0`
   * against `front 2.1.0` — two repos that version themselves independently —
   * and report half the estate as late for having smaller numbers.
   */
  behind: boolean;
}

/**
 * Every reading, each judged against the furthest release of its own repo.
 *
 * Deliberately the furthest anywhere and not "what prod runs": which
 * environment ought to be ahead is a pipeline order this data does not have.
 * What can be said without inventing anything is that a newer release of this
 * repo exists somewhere and this environment is not on it.
 *
 * A failed reading states no release, so it is neither a candidate for the
 * furthest one nor ever late: a version we could not fetch is not a version
 * that went backwards.
 */
export function judgeReadings(versions: readonly EnvironmentVersion[]): JudgedReading[] {
  const furthest = new Map<string, string>();
  for (const reading of versions) {
    if (!reading.version) continue;
    const held = furthest.get(reading.repo) ?? null;
    if (held === null || compareReleases(reading.version, held) === 1) {
      furthest.set(reading.repo, reading.version);
    }
  }

  return versions.map((reading) => ({
    reading,
    behind: compareReleases(reading.version, furthest.get(reading.repo) ?? null) === -1,
  }));
}

/** One crossing of the chosen axes, and everything that landed on it. */
export interface VersionCell {
  row: string;
  column: string;
  /** Empty where the crossing holds nothing — a hole, not a zero. */
  readings: JudgedReading[];
  /**
   * The release the cell reports, when its readings agree on one. Null when
   * they disagree, and null when none of them states a release at all.
   */
  version: string | null;
  /**
   * True when the readings state more than one release. The cell then names no
   * version: answering with one of them would claim a set of environments runs
   * a release it does not agree on.
   */
  mixed: boolean;
  /** True when any reading here is behind its own repo — see `JudgedReading`. */
  behind: boolean;
}

export interface VersionGrid {
  rows: string[];
  columns: string[];
  cells: VersionCell[];
}

/**
 * The readings laid out over two axes.
 *
 * Placement only: every judgement was made in `judgeReadings`, so changing the
 * axes rearranges the grid without ever changing what it claims. `repo` and
 * `environment` are the two axes a reading always carries; anything else is a
 * classification key, and a reading whose environment the rules said nothing
 * about lands in the unclassified bucket rather than disappearing.
 *
 * **Both axes are ordered alphabetically**, which refuses two tempting orders.
 * A pipeline order — dev, then staging, then prod — is the one a reader wants
 * and nothing stored here can derive: an environment is a name, and no field
 * ranks them. Ordering by recency instead would rearrange the columns between
 * two refreshes, which is worse than an imperfect order — a grid is read by
 * position, and a column that moves is a column that gets misread.
 *
 * Every crossing is kept, including the empty ones: "this repo has no staging"
 * is an answer, and a grid with holes punched out of it stops being alignable.
 */
export function pivotVersions(
  judged: readonly JudgedReading[],
  rowKey: string,
  columnKey: string,
): VersionGrid {
  const rows = distinct(judged, rowKey);
  const columns = distinct(judged, columnKey);

  const byCrossing = new Map<string, JudgedReading[]>();
  for (const item of judged) {
    const crossing = key(axisValue(item.reading, rowKey), axisValue(item.reading, columnKey));
    const held = byCrossing.get(crossing);
    if (held) held.push(item);
    else byCrossing.set(crossing, [item]);
  }

  const cells = rows.flatMap((row) =>
    columns.map((column) => {
      const readings = byCrossing.get(key(row, column)) ?? [];
      const releases = distinctReleases(readings);
      return {
        row,
        column,
        readings,
        version: releases.length === 1 ? releases[0] : null,
        mixed: releases.length > 1,
        behind: readings.some((item) => item.behind),
      };
    }),
  );

  return { rows, columns, cells };
}

/**
 * What a reading is worth on one axis. The two intrinsic ones are read off the
 * reading itself; everything else is a classification attribute.
 */
export function axisValue(reading: EnvironmentVersion, axis: string): string {
  if (axis === REPO_AXIS) return reading.repo;
  if (axis === ENVIRONMENT_AXIS) return reading.environment;
  return reading.attributes[axis] ?? UNCLASSIFIED;
}

/**
 * The releases a cell holds, deduplicated on the release rather than on the
 * string: `1.4.2` and `v1.4.2` are one release spelled twice, and reporting
 * them as a disagreement would cry wolf over a naming convention.
 *
 * Readings that state no release are left out — a failed probe is not a second
 * opinion — and the spelling kept is the first one seen, so what the cell shows
 * is a version somebody could search for rather than one this code invented.
 */
function distinctReleases(readings: readonly JudgedReading[]): string[] {
  const seen = new Map<string, string>();
  for (const { reading } of readings) {
    if (!reading.version) continue;
    const release = releaseIn(reading.version) ?? reading.version;
    if (!seen.has(release)) seen.set(release, reading.version);
  }
  return [...seen.values()];
}

/** Values seen on an axis, alphabetically, with the unclassified bucket last. */
function distinct(judged: readonly JudgedReading[], axis: string): string[] {
  const values = [...new Set(judged.map((item) => axisValue(item.reading, axis)))];
  return values.sort((a, b) => {
    if (a === UNCLASSIFIED) return 1;
    if (b === UNCLASSIFIED) return -1;
    return a.localeCompare(b);
  });
}

/** Joined on NUL, which no repo, environment name or attribute value carries. */
function key(row: string, column: string): string {
  return `${row}\u0000${column}`;
}
