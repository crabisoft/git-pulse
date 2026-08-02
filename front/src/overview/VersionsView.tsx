import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { OverviewReport } from '@repo/shared';
import { useAuth } from '../auth';
import { FilterField } from '../Filters';
import { agreesWithRef, readingAge } from '../versions';
import { ENVIRONMENT_AXIS, REPO_AXIS, versionAxisKeys, type Axes } from './axes';
import { matrixScrollClass, SectionHead } from './parts';
import { judgeReadings, pivotVersions, type JudgedReading, type VersionCell } from './releases';

/** What `t` is, for the helpers below that only format a label. */
type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * Direction D — what is running where.
 *
 * The other three directions are about movement: how fast it goes out, what
 * just happened, where the delivery stands. This one is about **state**, and it
 * is the only question of the four a deployment record cannot answer — a
 * deployment says something was sent, and an environment answering its own
 * version says it arrived.
 *
 * A grid because the interesting reading is comparative, and its axes are free
 * because "which environment of this application is behind" is only the first
 * question: with rules extracting a client, "which client is left on the old
 * release" is the same data crossed differently. What the grid *claims* never
 * changes with the layout — every judgement is made before it, in
 * `judgeReadings`.
 */
export function VersionsView({
  report,
  slug,
  axes,
  onAxesChange,
  filtered,
  onClearFilters,
  onOpenHistory,
}: {
  report: OverviewReport;
  slug: string;
  /** The crossing, already resolved for this direction by the page. */
  axes: Axes;
  onAxesChange: (next: Partial<Axes>) => void;
  /**
   * Whether anything is narrowing the page. The readings obey the same filters
   * as everything else, so an empty grid under a filter is a different fact
   * from an empty grid without one — and only one of the two is worth sending
   * somebody to the rules for.
   */
  filtered: boolean;
  onClearFilters: () => void;
  /**
   * Opens the timeline of one environment. Given the pair rather than a cell:
   * a cell can fold several readings, and a timeline is about one environment.
   */
  onOpenHistory: (pair: { repo: string; environment: string }) => void;
}) {
  const { t } = useTranslation();
  const { state } = useAuth();
  const signedIn = Boolean(state?.user);
  // Judged once, before any layout: lateness is a fact about a repo's own
  // environments, not about the cell an axis happens to drop a reading into.
  const judged = judgeReadings(report.versions);

  return (
    <section>
      <div className="matrix-head">
        <SectionHead
          title={t('overview.versions.title')}
          count={t('overview.versions.count', { count: report.versions.length })}
        />
        {judged.length > 0 && (
          <AxisPickers axes={axes} dimensions={report.dimensions} onChange={onAxesChange} />
        )}
      </div>

      {/* Four empty states, and they are four different facts. Merging them
          into one "nothing to show" would send an admin looking for a broken
          probe when the answer is that nobody signed in — or that they are
          looking at one client and the versions belong to another. */}
      {!signedIn ? (
        <p className="muted empty-note">
          {t('overview.versions.signedOut')} <Link to="/login">{t('auth.signIn')}</Link>
        </p>
      ) : judged.length === 0 && filtered ? (
        <p className="muted empty-note">
          {t('overview.versions.filteredOut')}{' '}
          <button type="button" className="link-button" onClick={onClearFilters}>
            {t('overview.versions.clearFilters')}
          </button>
        </p>
      ) : judged.length === 0 ? (
        <p className="muted empty-note">
          {t('overview.versions.empty')}{' '}
          <Link to="/settings/versions">{t('overview.versions.configure')}</Link>
        </p>
      ) : (
        <Grid judged={judged} axes={axes} slug={slug} onOpenHistory={onOpenHistory} />
      )}
    </section>
  );
}

/**
 * The two axis pickers, in the shape and the place the instrument matrix puts
 * them: the same control answering the same question on a neighbouring
 * direction has no business looking different.
 */
function AxisPickers({
  axes,
  dimensions,
  onChange,
}: {
  axes: Axes;
  dimensions: Record<string, string[]>;
  onChange: (next: Partial<Axes>) => void;
}) {
  const { t } = useTranslation();
  const keys = versionAxisKeys(dimensions);

  return (
    <div className="matrix-axes">
      <FilterField label={t('overview.matrix.rows')}>
        <select value={axes.rows} onChange={(e) => onChange({ rows: e.target.value })}>
          {keys.map((key) => (
            <option key={key} value={key}>
              {axisLabel(t, key)}
            </option>
          ))}
        </select>
      </FilterField>
      <FilterField label={t('overview.matrix.columns')}>
        <select value={axes.columns} onChange={(e) => onChange({ columns: e.target.value })}>
          {keys
            .filter((key) => key !== axes.rows)
            .map((key) => (
              <option key={key} value={key}>
                {axisLabel(t, key)}
              </option>
            ))}
        </select>
      </FilterField>
    </div>
  );
}

/**
 * The two intrinsic axes are named in the reader's language; a classification
 * key is printed as the rules spell it, which is how it appears everywhere else
 * on the page.
 */
function axisLabel(t: Translate, axis: string): string {
  return axis === REPO_AXIS || axis === ENVIRONMENT_AXIS
    ? t(`overview.versions.axis.${axis}`)
    : axis;
}

function Grid({
  judged,
  axes,
  slug,
  onOpenHistory,
}: {
  judged: JudgedReading[];
  axes: Axes;
  slug: string;
  onOpenHistory: (pair: { repo: string; environment: string }) => void;
}) {
  const { t } = useTranslation();
  const { rows, columns, cells } = pivotVersions(judged, axes.rows, axes.columns);
  const byRow = new Map(rows.map((row) => [row, cells.filter((cell) => cell.row === row)]));

  return (
    <div className={matrixScrollClass(columns.length)}>
      <div
        className="matrix versions-matrix"
        style={{
          gridTemplateColumns: `minmax(120px, .8fr) repeat(${columns.length}, minmax(132px, 1fr))`,
        }}
      >
        <div className="matrix-corner">
          {axisLabel(t, axes.rows)} ╲ {axisLabel(t, axes.columns)}
        </div>
        {columns.map((column) => (
          <div key={column} className="matrix-column">
            {column || t('overview.unclassified')}
          </div>
        ))}
        {rows.map((row) => (
          <Row
            key={row}
            row={row}
            axis={axes.rows}
            columns={columns}
            cells={byRow.get(row) ?? []}
            slug={slug}
            onOpenHistory={onOpenHistory}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  row,
  axis,
  columns,
  cells,
  slug,
  onOpenHistory,
}: {
  row: string;
  /** What the heading is a value of — only a repo has a page to open. */
  axis: string;
  columns: string[];
  cells: VersionCell[];
  slug: string;
  onOpenHistory: (pair: { repo: string; environment: string }) => void;
}) {
  const { t } = useTranslation();
  const byColumn = new Map(cells.map((cell) => [cell.column, cell]));

  return (
    <>
      <div className="matrix-row-head">
        {/* A repo row leads to its deployments: a line that looks wrong is read
            here and explained there. A client or an app is not a repo, so there
            is nothing to open — a link that guessed would guess wrong. */}
        {axis === REPO_AXIS ? (
          <Link to={`/deployments/${slug}?repos=${encodeURIComponent(row)}`}>{row}</Link>
        ) : (
          row || t('overview.unclassified')
        )}
      </div>
      {columns.map((column) => (
        <Cell key={column} cell={byColumn.get(column)} onOpenHistory={onOpenHistory} />
      ))}
    </>
  );
}

/**
 * One crossing. Never a blank, and never a release this code picked:
 *
 * - nothing read — a dash, which says this crossing does not exist;
 * - one release, however many readings state it — the version, its age, and a
 *   mark when it is behind its own repo or disagrees with the ref deployed to
 *   it;
 * - **several releases** — said as such and never resolved silently: answering
 *   with one of them would claim a set of environments runs a release it does
 *   not agree on. The matrix's own `+N` carries the count, and the detail hangs
 *   off the cell;
 * - read and failing — the reason, in the warning tone. An environment that
 *   stopped answering must never look like one still serving last week's
 *   version.
 */
function Cell({
  cell,
  onOpenHistory,
}: {
  cell: VersionCell | undefined;
  onOpenHistory: (pair: { repo: string; environment: string }) => void;
}) {
  const { t } = useTranslation();
  const readings = cell?.readings ?? [];

  if (!cell || readings.length === 0) {
    return (
      <div className="matrix-cell empty">
        <span className="matrix-none">—</span>
      </div>
    );
  }

  // What the cell is standing in front of, whichever shape it takes below.
  const detail = readings
    .map(({ reading }) => `${reading.repo} · ${reading.environment}: ${reading.version ?? '—'}`)
    .join('\n');
  const pair = singlePair(cell);
  const open = pair ? () => onOpenHistory(pair) : undefined;

  if (cell.mixed) {
    return (
      <CellShell className="ko version-cell mixed" title={detail} onOpen={open}>
        <span className="matrix-ref">
          {t('overview.versions.mixed')}
          <span className="matrix-more">
            {t('overview.matrix.more', { count: readings.length })}
          </span>
        </span>
        <span className="matrix-sub muted">{t('overview.versions.mixedHint')}</span>
      </CellShell>
    );
  }

  // No release anywhere in the cell: every reading here failed, so it reports
  // the failure rather than a version it does not have.
  if (cell.version === null) {
    const failed = readings[0].reading;
    return (
      <CellShell className="idle version-cell failed" title={detail} onOpen={open}>
        <span className="matrix-ref">{t(`versions.status.${failed.status}`)}</span>
        <span className="matrix-sub muted">
          {failed.error ? t(failed.error.code, failed.error.params) : ageLabel(t, failed.observedAt)}
        </span>
      </CellShell>
    );
  }

  // The freshest reading speaks for the cell's age and its ref: when several
  // agree on a release, the most recent is the one still describing it.
  const newest = [...readings].sort((a, b) =>
    b.reading.observedAt.localeCompare(a.reading.observedAt),
  )[0].reading;
  const agreement = agreesWithRef(newest.version, newest.ref);

  return (
    <CellShell className={`${cell.behind ? 'ko' : 'ok'} version-cell`} title={detail} onOpen={open}>
      <span className="matrix-ref mono">
        {cell.version}
        {cell.behind && (
          <span className="pill version-gap" title={t('overview.versions.behindHint')}>
            {t('overview.versions.behind')}
          </span>
        )}
        {readings.length > 1 && (
          <span className="matrix-more">
            {t('overview.matrix.more', { count: readings.length })}
          </span>
        )}
      </span>
      <span className="matrix-sub muted">
        {/* The other gap, and a different one: this reading against the ref
            deployed *to it*, rather than against its own repo's furthest. */}
        {agreement === 'differs' && (
          <span
            className="version-drift"
            title={t('overview.versions.driftHint', { ref: newest.ref })}
          >
            ≠ {newest.ref}
            {' · '}
          </span>
        )}
        {ageLabel(t, newest.observedAt)}
      </span>
    </CellShell>
  );
}

/**
 * A cell, opened or not.
 *
 * A real `<button>` where there is a timeline behind it: it is an action, so it
 * has to answer the keyboard, take focus and announce itself as one — none of
 * which a `div` with an onClick does, however many handlers are bolted onto it.
 * Everywhere else a plain cell, because a control that does nothing is worse
 * than no control.
 */
function CellShell({
  className,
  title,
  onOpen,
  children,
}: {
  className: string;
  title: string;
  onOpen: (() => void) | undefined;
  children: React.ReactNode;
}) {
  if (!onOpen) return <div className={`matrix-cell ${className}`} title={title}>{children}</div>;
  return (
    <button type="button" className={`matrix-cell openable ${className}`} title={title} onClick={onOpen}>
      {children}
    </button>
  );
}

/**
 * The one environment a cell speaks for, or null when it speaks for several.
 *
 * A timeline is the story of one `(repo, environment)`. Crossed on `client` a
 * cell can hold four of them, and opening whichever came first would answer a
 * question nobody asked — so such a cell simply does not open.
 */
function singlePair(cell: VersionCell): { repo: string; environment: string } | null {
  const pairs = new Map(
    cell.readings.map(({ reading }) => [
      `${reading.repo}\u0000${reading.environment}`,
      { repo: reading.repo, environment: reading.environment },
    ]),
  );
  return pairs.size === 1 ? [...pairs.values()][0] : null;
}

function ageLabel(t: Translate, observedAt: string): string {
  const age = readingAge(observedAt);
  return t(`versions.age.${age.unit}`, { count: age.count });
}
