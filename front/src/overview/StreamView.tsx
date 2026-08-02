import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Incident, OverviewReport } from '@repo/shared';
import { api, type OverviewQuery } from '../api';
import { useCancellableLoad } from '../hooks';
import { Sparkline } from '../Sparkline';
import { formatValue } from '../doraFormat';
import { SectionHead, sparkTone, statusKey, toneOf } from './parts';
import { dayOf, toStream, within, type StreamEntry } from './stream';

/** How many environments the side rail lists before it stops naming them. */
const RAIL_MAX = 8;

/**
 * How much of the recent past the journal covers.
 *
 * Matched to what the overview sends back, and stated in both units because
 * both are read: the incidents route takes days, the rail is labelled in hours.
 */
const JOURNAL_DAYS = 2;
const JOURNAL_HOURS = JOURNAL_DAYS * 24;

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
 * A rail of the **last two days**, and not of the reporting period. What is
 * read here is what has just happened; the period governs the metrics beside
 * it. Two days rather than one because a Monday morning has to show Friday
 * evening — and when there is genuinely nothing, the journal says so in those
 * words rather than leaving the period to be blamed for it.
 *
 * The incidents are fetched here rather than with the rest of the page: they
 * come from a tracker on another platform, with a budget of its own, and only
 * this view spends it.
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
          // The rail's own window, not the page's: an incident from six weeks
          // ago on a two-day journal would be the only line on it.
          { windowDays: JOURNAL_DAYS, repos: query.repos },
          signal,
        ),
      ),
    [sourceId, query.repos],
  );
  // Degraded on purpose: no tracker, or one that refused, still leaves a
  // timeline of releases worth reading.
  const { error } = useCancellableLoad(load);

  // Cut here rather than trusted from either feed: the events arrive over the
  // window the API sends, the incidents over the one asked for, and the rail
  // has to be one window.
  const entries = within(toStream(report.events, incidents), JOURNAL_HOURS);
  // What runs, like the matrix: the rail beside a journal answers "and where
  // does that leave us", which no period narrows.
  const environments = report.running;

  return (
    <div className="stream">
      <section>
        <SectionHead
          title={t('overview.stream.title')}
          count={t('overview.stream.window', { hours: JOURNAL_HOURS })}
        />
        {error && <div className="banner warn">{error}</div>}
        {entries.length === 0 ? (
          // Named in hours, because the period filter above says something
          // else: "nothing on this scope" over a window nobody chose reads as
          // a broken filter rather than as a quiet two days.
          <p className="muted empty-note">{t('overview.stream.empty', { hours: JOURNAL_HOURS })}</p>
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
              <span className="mono env-ref">{env.ref ?? '—'}</span>
              <span className={`state ${toneOf(env.lastStatus)}`}>
                {t(statusKey(env.lastStatus))}
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
