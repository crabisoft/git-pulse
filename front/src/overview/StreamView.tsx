import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Incident, OverviewReport } from '@repo/shared';
import { api, type OverviewQuery } from '../api';
import { useCancellableLoad } from '../hooks';
import { Sparkline } from '../Sparkline';
import { formatValue } from '../doraFormat';
import { SectionHead, sparkTone, toneOf } from './parts';
import { dayOf, toStream, type StreamEntry } from './stream';

/** How many environments the side rail lists before it stops naming them. */
const RAIL_MAX = 8;

/** Glyph per kind of entry — read alongside the colour, never instead of it. */
const MARK: Record<StreamEntry['kind'], string> = {
  deploy: '▲',
  failure: '✕',
  incident: '◆',
  resolved: '◇',
};

/**
 * Direction C — the delivery stream.
 *
 * The question on call is not "what is the rate" but "what happened, and in
 * what order". Deployments and incidents are interleaved on one rail, so an
 * incident that lands twenty minutes after a release reads as a sequence
 * rather than as two numbers on two pages.
 *
 * Incidents are fetched here rather than with the rest of the page: they come
 * from a tracker on another platform, with a budget of its own, and only this
 * view spends it.
 */
export function StreamView({
  report,
  sourceId,
  query,
}: {
  report: OverviewReport;
  sourceId: string;
  query: OverviewQuery;
}) {
  const { t } = useTranslation();
  const [incidents, setIncidents] = useState<Incident[]>([]);

  const load = useCallback(
    async (signal: AbortSignal) =>
      setIncidents(
        await api.incidents(
          sourceId,
          { from: query.from, to: query.to, windowDays: query.windowDays, repos: query.repos },
          signal,
        ),
      ),
    [sourceId, query.from, query.to, query.windowDays, query.repos],
  );
  // Degraded on purpose: no tracker, or one that refused, still leaves a
  // timeline of deployments worth reading.
  const { error } = useCancellableLoad(load);

  const entries = toStream(report.events, incidents);
  const environments = report.environments;

  return (
    <div className="stream">
      <section>
        <SectionHead
          title={t('overview.stream.title')}
          count={t('overview.stream.count', { count: entries.length })}
        />
        {error && <div className="banner warn">{error}</div>}
        {entries.length === 0 ? (
          <p className="muted empty-note">{t('overview.stream.empty')}</p>
        ) : (
          <div className="river">
            <Entries entries={entries} />
          </div>
        )}
      </section>

      <aside className="rail">
        <div className="rail-block">
          <SectionHead
            title={t('overview.flow.title')}
            count={t('overview.flow.period', { days: report.period.windowDays ?? '—' })}
          />
          {report.flow.map((flow) => (
            <div className="rail-row" key={flow.metric}>
              <span>{t(`dora.metric.${flow.metric}`)}</span>
              <Sparkline values={flow.trend} tone={sparkTone(flow)} width={56} height={18} />
              <span className="flow-value">{formatValue(flow)}</span>
            </div>
          ))}
        </div>

        <div className="rail-block">
          <SectionHead
            title={t('overview.board.title')}
            count={t('overview.board.count', { count: environments.length })}
          />
          {environments.slice(0, RAIL_MAX).map((env) => (
            <div className="rail-row" key={env.name}>
              <span className="env-name">{env.name}</span>
              <span className="mono env-ref">{env.ref}</span>
              <span className={`state ${toneOf(env.lastStatus)}`}>
                {t(`status.${env.lastStatus}`)}
              </span>
            </div>
          ))}
          {environments.length > RAIL_MAX && (
            <p className="muted empty-note">
              {t('overview.stream.more', { count: environments.length - RAIL_MAX })}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

/** The rail itself, with a rule wherever the calendar day changes. */
function Entries({ entries }: { entries: StreamEntry[] }) {
  const { t } = useTranslation();
  let day: string | null = null;

  return (
    <>
      {entries.map((entry) => {
        const entryDay = dayOf(entry.at);
        const opensDay = entryDay !== day;
        day = entryDay;
        return (
          <div key={entry.id}>
            {opensDay && <p className="day-rule">{dayLabel(t, entry.at)}</p>}
            <div className={`entry ${entry.kind}`}>
              <span className="entry-time">{timeLabel(entry.at)}</span>
              <span className="entry-mark" aria-hidden="true">
                {MARK[entry.kind]}
              </span>
              <span className="entry-main">
                <span className="entry-title">
                  {entry.url ? (
                    <a href={entry.url} target="_blank" rel="noreferrer">
                      {entry.title}
                    </a>
                  ) : (
                    <b>{entry.title}</b>
                  )}
                  <span className="entry-kind">{t(`overview.stream.kind.${entry.kind}`)}</span>
                </span>
                {entry.detail && <span className="entry-detail">{entry.detail}</span>}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Today and yesterday by name, anything older by date. */
function dayLabel(t: (key: string) => string, iso: string): string {
  const day = dayOf(iso);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (day === dayOf(now.toISOString())) return t('overview.stream.today');
  if (day === dayOf(yesterday.toISOString())) return t('overview.stream.yesterday');
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}
