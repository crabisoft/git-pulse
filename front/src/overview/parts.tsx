import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type {
  DashboardEnvironment,
  OverviewEvent,
  OverviewFlow,
  OverviewReport,
  PipelineStatus,
} from '@repo/shared';
import { Sparkline } from '../Sparkline';
import { formatValue, humanizeDuration } from '../doraFormat';
import { UNCLASSIFIED } from './grouping';

/**
 * The pieces the three directions share.
 *
 * A direction changes what is put in front of the reader and in what order —
 * not what a failed deployment looks like. Keeping these here is what stops
 * three views from drifting into three vocabularies for the same fact.
 */

/** The window the bottom strip covers, matched to what the API sends back. */
export const EVENT_WINDOW_HOURS = 24;

/** One environment: what runs there, how it has been going, and since when. */
export function EnvironmentRow({ env, keys }: { env: DashboardEnvironment; keys: string[] }) {
  const { t } = useTranslation();
  return (
    <div className={`board-row${env.lastStatus === 'failed' ? ' alert' : ''}`}>
      <span className="env-name">{env.name}</span>
      <Heartbeat statuses={env.recent} />
      <StatusMark status={env.lastStatus} />
      <span className="mono env-ref">{env.ref}</span>
      <span className="pills env-dims">
        {keys.map((key) =>
          env.attributes[key] ? (
            <span key={key} className="pill attr">
              <b>{key}</b>={env.attributes[key]}
            </span>
          ) : (
            <span key={key} className="pill attr missing" title={t('overview.unclassifiedHint')}>
              <b>{key}</b> {t('overview.unclassified')}
            </span>
          ),
        )}
      </span>
      <span className="env-age">{t('overview.since', { at: sinceLabel(env.lastDeployAt) })}</span>
    </div>
  );
}

/**
 * The outcome of the last deployments, oldest on the left. A failure is a
 * notch as well as a colour: a run of them and an isolated one are the same
 * `lastStatus`, and telling them apart is the whole point of the strip.
 */
export function Heartbeat({ statuses }: { statuses: PipelineStatus[] }) {
  const { t } = useTranslation();
  return (
    <span
      className="heartbeat"
      role="img"
      aria-label={t('overview.heartbeat', {
        count: statuses.length,
        failed: statuses.filter((s) => s === 'failed').length,
      })}
    >
      {statuses.map((status, i) => (
        <i key={i} className={status === 'failed' ? 'ko' : status === 'running' ? 'run' : 'ok'} />
      ))}
    </span>
  );
}

export function StatusMark({ status }: { status: PipelineStatus }) {
  const { t } = useTranslation();
  return <span className={`state ${toneOf(status)}`}>{t(`status.${status}`)}</span>;
}

/** Four states rather than every pipeline status: this is a traffic light. */
export function toneOf(status: PipelineStatus): 'ok' | 'ko' | 'run' | 'idle' {
  if (status === 'failed') return 'ko';
  if (status === 'running') return 'run';
  return status === 'success' ? 'ok' : 'idle';
}

/** A metric, where it is going, and whether that is good news. */
export function FlowRow({ flow, slug }: { flow: OverviewFlow; slug: string }) {
  const { t } = useTranslation();
  return (
    <Link className="flow-row" to={`/dora/${slug}/${flow.metric}`}>
      <span className="flow-label">{t(`dora.metric.${flow.metric}`)}</span>
      <Sparkline values={flow.trend} tone={sparkTone(flow)} />
      <span className="flow-value">{formatValue(flow)}</span>
      <Delta flow={flow} />
    </Link>
  );
}

export function sparkTone(flow: OverviewFlow): 'good' | 'bad' | 'neutral' {
  if (flow.improving === null) return 'neutral';
  return flow.improving ? 'good' : 'bad';
}

/**
 * The movement across the window. Stable is its own reading rather than a zero
 * dressed as a rise: a metric that has not moved is not improving.
 */
export function Delta({ flow }: { flow: OverviewFlow }) {
  const { t } = useTranslation();
  if (flow.delta === null) return <span className="delta flat">{t('overview.flow.noTrend')}</span>;

  const percent = Math.round(flow.delta * 100);
  if (percent === 0) return <span className="delta flat">{t('overview.flow.stable')}</span>;
  return (
    <span className={`delta ${flow.improving ? 'up' : 'down'}`}>
      {percent > 0 ? '▲' : '▼'} {Math.abs(percent)} %
    </span>
  );
}

/** What is in the way right now, most actionable first. */
export function Friction({
  friction,
  health,
  staleHours,
}: {
  friction: OverviewReport['friction'];
  health: OverviewReport['health'];
  staleHours: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="friction">
      <FrictionRow
        tone={friction.stalePrs > 0 ? 'warn' : 'idle'}
        label={t('overview.friction.stalePrs', { hours: staleHours ?? 72 })}
        value={`${friction.stalePrs} / ${friction.openPrs}`}
      />
      <FrictionRow
        tone={friction.failedPipelines > 0 ? 'crit' : 'idle'}
        label={t('overview.friction.failedPipelines')}
        value={String(friction.failedPipelines)}
      />
      <FrictionRow
        tone="idle"
        label={t('overview.friction.runningPipelines')}
        value={String(friction.runningPipelines)}
      />
      <FrictionRow
        tone="idle"
        label={t('overview.friction.reviewTime')}
        value={friction.reviewTimeSec === null ? '—' : humanizeDuration(friction.reviewTimeSec)}
      />
      {health.staleForSec !== null && (
        <FrictionRow
          tone={health.staleForSec > 3600 ? 'warn' : 'idle'}
          label={t('overview.friction.lastCollection')}
          value={humanizeDuration(health.staleForSec)}
        />
      )}
    </div>
  );
}

function FrictionRow({
  tone,
  label,
  value,
}: {
  tone: 'warn' | 'crit' | 'idle';
  label: string;
  value: string;
}) {
  return (
    <div className={`friction-row ${tone}`}>
      <span className="friction-mark" aria-hidden="true">
        {tone === 'crit' ? '✕' : tone === 'warn' ? '⚠' : '·'}
      </span>
      <span>{label}</span>
      <span className="friction-value">{value}</span>
    </div>
  );
}

/**
 * The last day, one lane per value of the dimension being grouped on — or one
 * lane for everything when nothing is. Ticks rather than labels: at this width
 * the question is "how often, and did any of them fail", not "which one".
 */
export function Timeline({
  events,
  dimension,
}: {
  events: OverviewEvent[];
  dimension: string | null;
}) {
  const { t } = useTranslation();
  if (events.length === 0) return <p className="muted empty-note">{t('overview.events.empty')}</p>;

  const now = Date.now();
  const span = EVENT_WINDOW_HOURS * 3600 * 1000;
  const lanes = new Map<string, OverviewEvent[]>();
  for (const event of events) {
    const key = dimension ? (event.attributes[dimension] ?? UNCLASSIFIED) : '';
    const lane = lanes.get(key);
    if (lane) lane.push(event);
    else lanes.set(key, [event]);
  }

  return (
    <div className="timeline">
      <div className="timeline-axis">
        {['-24h', '-20h', '-16h', '-12h', '-8h', '-4h', t('overview.events.now')].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {[...lanes.entries()].map(([key, laneEvents]) => (
        <div className="timeline-lane" key={key || 'all'}>
          <span className="timeline-name">
            {key || (dimension ? t('overview.unclassified') : t('overview.events.all'))}
          </span>
          <span className="timeline-track">
            {laneEvents.map((event) => {
              const left = 100 - ((now - new Date(event.at).getTime()) / span) * 100;
              return (
                <i
                  key={`${event.environment}-${event.at}`}
                  className={event.status === 'failed' ? 'ko' : ''}
                  style={{ left: `${Math.min(100, Math.max(0, left))}%` }}
                  title={`${event.environment} — ${event.ref}`}
                />
              );
            })}
            <i className="timeline-now" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** A section title, in the small-caps the whole page labels its blocks with. */
export function SectionHead({ title, count }: { title: string; count?: string }) {
  return (
    <p className="section-head">
      {title}
      {count !== undefined && <span className="section-count">{count}</span>}
    </p>
  );
}

/** Rough age of a date, in the units the rest of the page counts in. */
export function sinceLabel(iso: string): string {
  return humanizeDuration(Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000));
}
