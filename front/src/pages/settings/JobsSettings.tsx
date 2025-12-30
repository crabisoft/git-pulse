import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  JobFailure,
  JobWarning,
  JobsSnapshot,
  Page,
  QueueSummary,
  SourcePublic,
} from '@repo/shared';
import { api, apiErrorInfo } from '../../api';
import { useCancellableLoad } from '../../hooks';
import { DeleteIcon, SyncIcon } from '../../icons';
import { IconButton } from '../../IconButton';
import { ConfirmDialog } from '../../Modal';

/**
 * How often the page re-reads the queues.
 *
 * None of this is stored: what is shown is a reading of Redis at the instant,
 * and a queue drains in seconds. Short enough to watch a collection go through,
 * long enough that a page left open on a second screen is not a load.
 */
const REFRESH_MS = 5_000;

/** Rows of each list. Both are read newest first, which is what is looked at. */
const LIST_LIMIT = 20;

/**
 * What the install is doing when nobody is watching.
 *
 * Reads the queues rather than Redis itself: memory and keyspace answer none of
 * the questions asked here — whether the last collection went through, what
 * gave up, and when the next one fires. Redis is the transport, not the subject.
 */
export function JobsSettings({ sources }: { sources: SourcePublic[] }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<JobsSnapshot | null>(null);
  const [failures, setFailures] = useState<Page<JobFailure> | null>(null);
  const [degraded, setDegraded] = useState<Page<JobWarning> | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [discarding, setDiscarding] = useState<JobFailure | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const [next, failed, warned] = await Promise.all([
      api.jobs(signal),
      api.failedJobs({ limit: LIST_LIMIT }, signal),
      api.degradedJobs({ limit: LIST_LIMIT }, signal),
    ]);
    setSnapshot(next);
    setFailures(failed);
    setDegraded(warned);
  }, []);

  const { reload, error } = useCancellableLoad(load);

  // Polled rather than pushed: the counts are a reading, and a reading nobody
  // refreshes is a screenshot. The hook cancels whichever run this supersedes.
  useEffect(() => {
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name ?? id;

  async function act(failure: JobFailure, run: () => Promise<void>, okKey: string) {
    setActing(failure.id);
    setMsg(null);
    try {
      await run();
      setMsg({ kind: 'ok', text: t(okKey) });
      await reload();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    } finally {
      setActing(null);
    }
  }

  const totals = (key: keyof QueueSummary['counts']) =>
    (snapshot?.queues ?? []).reduce((sum, queue) => sum + queue.counts[key], 0);

  return (
    <>
      {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
      {error && <div className="banner error">{error}</div>}
      {snapshot?.unreachable && (
        <div className="banner error">
          {t('jobs.unreachable', { error: snapshot.unreachable.params?.error ?? '' })}
        </div>
      )}

      {snapshot === null && !error && <p className="muted">{t('common.loading')}</p>}

      {snapshot && !snapshot.unreachable && (
        <>
          <div className="tiles">
            <div className="tile accent">
              <div className="tile-value">{totals('active')}</div>
              <div className="tile-label">{t('jobs.count.active')}</div>
            </div>
            <div className="tile">
              <div className="tile-value">{totals('waiting')}</div>
              <div className="tile-label">{t('jobs.count.waiting')}</div>
            </div>
            <div className="tile">
              <div className="tile-value">{totals('delayed')}</div>
              <div className="tile-label">{t('jobs.count.delayed')}</div>
            </div>
            <div className={totals('failed') > 0 ? 'tile crit' : 'tile'}>
              <div className="tile-value">{totals('failed')}</div>
              <div className="tile-label">{t('jobs.count.failed')}</div>
            </div>
          </div>

          <section className="panel">
            <h2>{t('jobs.queues')}</h2>
            <p className="muted subtabs-hint">
              {t('jobs.observedAt', { at: at(snapshot.observedAt) })}
            </p>
            <table className="data">
              <thead>
                <tr>
                  <th>{t('jobs.queue')}</th>
                  <th>{t('jobs.count.waiting')}</th>
                  <th>{t('jobs.count.active')}</th>
                  <th>{t('jobs.count.delayed')}</th>
                  <th>{t('jobs.count.failed')}</th>
                  <th>{t('jobs.count.completed')}</th>
                  <th>{t('jobs.schedule')}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.queues.map((queue) => (
                  <tr key={queue.name}>
                    <td>
                      {t(`jobs.queueName.${queue.name}`)}
                      {queue.paused && <span className="pill status-pending">{t('jobs.paused')}</span>}
                    </td>
                    <td className="num">{queue.counts.waiting}</td>
                    <td className="num">{queue.counts.active}</td>
                    <td className="num">{queue.counts.delayed}</td>
                    <td className="num">{queue.counts.failed}</td>
                    <td className="num">{queue.counts.completed}</td>
                    <td>{schedule(queue, t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <section className="panel">
        <h2>{t('jobs.failures.title')}</h2>
        <p className="muted subtabs-hint">{t('jobs.failures.hint')}</p>

        {failures && failures.items.length === 0 && (
          <p className="muted">{t('jobs.failures.empty')}</p>
        )}

        {failures && failures.items.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>{t('jobs.job')}</th>
                <th>{t('jobs.subject')}</th>
                <th>{t('jobs.attempts')}</th>
                <th>{t('jobs.failedAt')}</th>
                <th>{t('jobs.reason')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {failures.items.map((failure) => (
                <tr key={`${failure.queue}:${failure.id}`}>
                  <td>
                    <span className="pill attr">{failure.name}</span>
                  </td>
                  <td>{subject(failure.data, sourceName)}</td>
                  <td className="num">{failure.attemptsMade}</td>
                  <td>{failure.failedAt ? at(failure.failedAt) : '—'}</td>
                  <td>
                    <details className="job-reason">
                      <summary>{failure.reason || t('jobs.noReason')}</summary>
                      {failure.stack && <pre>{failure.stack}</pre>}
                    </details>
                  </td>
                  <td className="row-actions">
                    <IconButton
                      label={t('jobs.retry')}
                      disabled={acting === failure.id}
                      onClick={() =>
                        void act(
                          failure,
                          () => api.retryJob(failure.queue, failure.id),
                          'jobs.retried',
                        )
                      }
                    >
                      <SyncIcon />
                    </IconButton>
                    <IconButton
                      label={t('jobs.discard')}
                      tone="danger"
                      disabled={acting === failure.id}
                      onClick={() => setDiscarding(failure)}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {degraded && degraded.items.length > 0 && (
        <section className="panel">
          <h2>{t('jobs.degraded.title')}</h2>
          <p className="muted subtabs-hint">{t('jobs.degraded.hint')}</p>
          <table className="data">
            <thead>
              <tr>
                <th>{t('jobs.job')}</th>
                <th>{t('jobs.subject')}</th>
                <th>{t('jobs.finishedAt')}</th>
                <th>{t('jobs.givenUp')}</th>
              </tr>
            </thead>
            <tbody>
              {degraded.items.map((run) => (
                <tr key={`${run.queue}:${run.id}`}>
                  <td>
                    <span className="pill attr">{run.name}</span>
                  </td>
                  <td>{subject(run.data, sourceName)}</td>
                  <td>{run.finishedAt ? at(run.finishedAt) : '—'}</td>
                  <td>
                    <ul className="job-warnings">
                      {run.warnings.map((warning, i) => (
                        <li key={i}>{t(warning.code, warning.params)}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {discarding && (
        <ConfirmDialog
          title={t('jobs.discard')}
          message={t('jobs.discardConfirm', { name: discarding.name })}
          confirmLabel={t('jobs.discard')}
          onClose={() => setDiscarding(null)}
          onConfirm={() => {
            const failure = discarding;
            setDiscarding(null);
            void act(failure, () => api.discardJob(failure.queue, failure.id), 'jobs.discarded');
          }}
        />
      )}
    </>
  );
}

/**
 * What a job was working on, read off the payload it carries.
 *
 * Deliberately shallow: a source id resolved to its name, and the kind of an
 * ingestion intent. Anything more and this becomes a renderer for every job
 * payload the install will ever add.
 */
export function subject(
  data: Record<string, unknown>,
  sourceName: (id: string) => string,
): string {
  const parts: string[] = [];
  if (typeof data.sourceId === 'string') parts.push(sourceName(data.sourceId));
  const intent = data.intent;
  if (intent && typeof intent === 'object' && 'kind' in intent) {
    parts.push(String((intent as { kind: unknown }).kind));
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** A queue's repeatables as one line: the pattern, and when it next fires. */
function schedule(queue: QueueSummary, t: TFunction): string {
  if (queue.repeatables.length === 0) return t('jobs.onDemand');
  return queue.repeatables
    .map((job) =>
      job.nextRunAt
        ? t('jobs.nextRun', { pattern: job.pattern, at: at(job.nextRunAt) })
        : job.pattern,
    )
    .join(', ');
}

function at(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}
