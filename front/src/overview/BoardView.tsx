import { useTranslation } from 'react-i18next';
import type { OverviewReport } from '@repo/shared';
import { groupEnvironments } from './grouping';
import { EnvironmentRow, FlowRow, Friction, SectionHead, Timeline } from './parts';

/**
 * Direction A — the control room.
 *
 * What is running first, then how fast things are going out, then what is in
 * the way, then the last day on a shared time axis. Read top to bottom it
 * answers "is anything wrong right now" before it answers anything else, which
 * is the order somebody glancing at a wall screen asks in.
 */
export function BoardView({
  report,
  fold,
  slug,
  staleHours,
}: {
  report: OverviewReport;
  /** The dimension the board is folded on, or null while it is flat. */
  fold: string | null;
  slug: string;
  staleHours: number | null;
}) {
  const { t } = useTranslation();
  const keys = Object.keys(report.dimensions);
  const groups = groupEnvironments(report.environments, fold);

  return (
    <>
      <section>
        <SectionHead
          title={t('overview.board.title')}
          count={t('overview.board.count', { count: report.environments.length })}
        />
        {report.environments.length === 0 ? (
          <p className="muted empty-note">{t('overview.board.empty')}</p>
        ) : (
          <div className="board">
            {groups.map((group) => (
              <div key={group.key || 'unclassified'}>
                {fold && (
                  <p className="group-head">
                    {group.key || t('overview.unclassified')}
                    <span className="group-count">
                      {t('overview.board.count', { count: group.environments.length })}
                    </span>
                    {group.alerts > 0 && (
                      <span className="group-alert">
                        {t('overview.board.alerts', { count: group.alerts })}
                      </span>
                    )}
                  </p>
                )}
                {group.environments.map((env) => (
                  <EnvironmentRow key={env.name} env={env} keys={keys} />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="split">
        <section>
          <SectionHead
            title={t('overview.flow.title')}
            count={t('overview.flow.period', { days: report.period.windowDays ?? '—' })}
          />
          {report.flow.length === 0 ? (
            <p className="muted empty-note">{t('overview.flow.empty')}</p>
          ) : (
            report.flow.map((flow) => <FlowRow key={flow.metric} flow={flow} slug={slug} />)
          )}
        </section>

        <section>
          <SectionHead title={t('overview.friction.title')} />
          <Friction friction={report.friction} health={report.health} staleHours={staleHours} />
        </section>
      </div>

      <section>
        <SectionHead
          title={t('overview.events.title')}
          count={t('overview.events.count', { count: report.events.length })}
        />
        <Timeline events={report.events} dimension={fold} />
      </section>
    </>
  );
}
