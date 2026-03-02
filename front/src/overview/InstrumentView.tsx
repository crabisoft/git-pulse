import { useTranslation } from 'react-i18next';
import type { OverviewFlow, OverviewReport } from '@repo/shared';
import { Sparkline } from '../Sparkline';
import { formatValue } from '../doraFormat';
import { FilterField } from '../Filters';
import { Gauge } from './Gauge';
import { tierOf, toTierValue } from './gauge';
import { pivotEnvironments } from './pivot';
import { Delta, Friction, SectionHead, sinceLabel, sparkTone, toneOf } from './parts';

/**
 * Direction B — the instrument panel.
 *
 * Two ideas, and they answer different questions. The gauges say where the
 * delivery stands on a scale somebody outside the team also reads. The matrix
 * says who is behind: with a client on one axis and an application on the
 * other, a stale version shows up as a shape long before anybody reads a
 * version number.
 */
export function InstrumentView({
  report,
  axes,
  onAxesChange,
  staleHours,
}: {
  report: OverviewReport;
  /** Which dimensions the matrix crosses. Null while the rules give too few. */
  axes: { rows: string; columns: string } | null;
  onAxesChange: (next: { rows?: string; columns?: string }) => void;
  staleHours: number | null;
}) {
  const { t } = useTranslation();
  const keys = Object.keys(report.dimensions);

  return (
    <>
      <section>
        <SectionHead
          title={t('overview.flow.title')}
          count={t('overview.flow.period', { days: report.period.windowDays ?? '—' })}
        />
        {report.flow.length === 0 ? (
          <p className="muted empty-note">{t('overview.flow.empty')}</p>
        ) : (
          <div className="gauges">
            {report.flow.map((flow) => (
              <GaugeCard key={flow.metric} flow={flow} windowDays={report.period.windowDays} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="matrix-head">
          <SectionHead
            title={t('overview.matrix.title')}
            count={t('overview.board.count', { count: report.environments.length })}
          />
          {axes && (
            <div className="matrix-axes">
              <FilterField label={t('overview.matrix.rows')}>
                <select value={axes.rows} onChange={(e) => onAxesChange({ rows: e.target.value })}>
                  {keys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label={t('overview.matrix.columns')}>
                <select
                  value={axes.columns}
                  onChange={(e) => onAxesChange({ columns: e.target.value })}
                >
                  {keys
                    .filter((key) => key !== axes.rows)
                    .map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                </select>
              </FilterField>
            </div>
          )}
        </div>
        <Matrix report={report} axes={axes} />
      </section>

      <section>
        <SectionHead title={t('overview.friction.title')} />
        <Friction friction={report.friction} health={report.health} staleHours={staleHours} />
      </section>
    </>
  );
}

/** One metric, as a position on the published scale plus the figure itself. */
function GaugeCard({ flow, windowDays }: { flow: OverviewFlow; windowDays: number | null }) {
  const { t } = useTranslation();
  const tierValue = toTierValue(flow.metric, flow.value, windowDays);
  const tier = tierOf(flow.metric, tierValue);

  return (
    <div className="gauge-card">
      <div className="gauge-wrap">
        {tier ? (
          <Gauge metric={flow.metric} tierValue={tierValue} tier={tier} />
        ) : (
          // A metric the report publishes no scale for. Inventing one would
          // dress a guess as a standard, so the figure stands on its own.
          <div className="gauge-blank" aria-hidden="true" />
        )}
        <span className="gauge-value">{formatValue(flow)}</span>
      </div>
      <span className={`gauge-tier tier-${tier ?? 'none'}`}>
        {tier ? t(`dora.tier.${tier}`) : t('overview.matrix.noTier')}
      </span>
      <span className="gauge-label">{t(`dora.metric.${flow.metric}`)}</span>
      <span className="gauge-trend">
        <Sparkline values={flow.trend} tone={sparkTone(flow)} />
        <Delta flow={flow} />
      </span>
    </div>
  );
}

/** The crossing itself, or the reason there is nothing to cross. */
function Matrix({
  report,
  axes,
}: {
  report: OverviewReport;
  axes: { rows: string; columns: string } | null;
}) {
  const { t } = useTranslation();

  if (report.environments.length === 0) {
    return <p className="muted empty-note">{t('overview.board.empty')}</p>;
  }
  if (!axes) {
    // One dimension cannot be crossed with itself. Said plainly, with what
    // would fix it, rather than shown as an empty grid.
    return <p className="muted empty-note">{t('overview.matrix.needsTwo')}</p>;
  }

  const { rows, columns, cells } = pivotEnvironments(report.environments, axes.rows, axes.columns);

  return (
    <div className="matrix-scroll">
      <div
        className="matrix"
        style={{ gridTemplateColumns: `minmax(96px, .7fr) repeat(${columns.length}, minmax(128px, 1fr))` }}
      >
        <div className="matrix-corner">
          {axes.rows} ╲ {axes.columns}
        </div>
        {columns.map((column) => (
          <div key={column} className="matrix-column">
            {column || t('overview.unclassified')}
          </div>
        ))}
        {rows.map((row) => (
          <Row key={row} row={row} columns={columns} cells={cells} />
        ))}
      </div>
    </div>
  );
}

function Row({
  row,
  columns,
  cells,
}: {
  row: string;
  columns: string[];
  cells: ReturnType<typeof pivotEnvironments>['cells'];
}) {
  const { t } = useTranslation();
  const byColumn = new Map(cells.filter((c) => c.row === row).map((c) => [c.column, c]));

  return (
    <>
      <div className="matrix-row-head">{row || t('overview.unclassified')}</div>
      {columns.map((column) => {
        const cell = byColumn.get(column);
        const env = cell?.environment ?? null;
        if (!env) {
          return (
            <div key={column} className="matrix-cell empty">
              <span className="matrix-none">—</span>
            </div>
          );
        }
        const others = cell?.others ?? [];
        return (
          <div key={column} className={`matrix-cell ${toneOf(env.lastStatus)}`} title={env.name}>
            <span className="matrix-ref mono">
              {env.ref}
              {/* The cell shows what is running here now. Two dimensions are
                  crossed and the rules may extract more, so others can share
                  the crossing — unsaid, the axes would hide them. */}
              {others.length > 0 && (
                <span
                  className="matrix-more"
                  title={t('overview.matrix.alsoHere', {
                    names: others.map((o) => o.name).join(', '),
                  })}
                >
                  {t('overview.matrix.more', { count: others.length })}
                </span>
              )}
            </span>
            <span className={`state ${toneOf(env.lastStatus)} matrix-sub`}>
              {t(`status.${env.lastStatus}`)} · {sinceLabel(env.lastDeployAt)}
            </span>
          </div>
        );
      })}
    </>
  );
}
