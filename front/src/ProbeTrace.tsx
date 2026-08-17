import { useTranslation } from 'react-i18next';
import type { VersionProbeAttempt, VersionProbeTrace } from '@repo/shared';

/**
 * Every address a probing run tried, environment by environment.
 *
 * The line above it says what the run *did* — three read, one failed. This says
 * where, and it exists because the reading filed against an environment keeps
 * exactly one attempt: the rule that was passed over, and the one that could
 * not be addressed at all, leave no other trace. Those are the two an author is
 * usually asking about, and the alternative to showing them here is reading the
 * API's logs.
 *
 * Folded away by default. A run that worked needs none of this, and somebody
 * who has just attached their first rule should see a sentence rather than a
 * table.
 */
export function ProbeTrace({ trace }: { trace?: VersionProbeTrace[] }) {
  const { t } = useTranslation();
  // Absent and empty are one case, and the type is optional on purpose: the web
  // bundle and the API are two images that can legitimately be a version apart,
  // and an API that does not send a walk yet must cost this panel and nothing
  // else. Read as `trace.length` it costs the whole page — there is no error
  // boundary above it, so one throw here unmounts the application.
  if (!trace?.length) return null;

  return (
    <details className="probe-trace">
      <summary>{t('sources.probe.trace.show', { count: trace.length })}</summary>
      <p className="field-note">{t('sources.probe.trace.explain')}</p>
      <ul>
        {trace.map((environment) => (
          <li key={`${environment.repo}/${environment.environment}`}>
            <div className="probe-trace-env mono">{named(environment)}</div>
            {environment.attempts.length === 0 ? (
              // Not an empty list: "no rule claims this environment" is a
              // finding, and the commonest one. Left blank it would read as a
              // panel that failed to load.
              <div className="probe-trace-attempt none">{t('sources.probe.trace.noRule')}</div>
            ) : (
              environment.attempts.map((attempt) => (
                <Attempt key={attempt.ruleId} attempt={attempt} />
              ))
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * One rule against one environment: what was asked, what came back, and whether
 * this is the attempt that became the reading.
 *
 * The response status where there is one and the outcome's own name where there
 * is not — a rule that could not be addressed never reached a server, and `—`
 * in that column would suggest it did and said nothing.
 */
function Attempt({ attempt }: { attempt: VersionProbeAttempt }) {
  const { t } = useTranslation();

  return (
    <div className={`probe-trace-attempt ${attempt.status}${attempt.filed ? ' filed' : ''}`}>
      <span className="probe-trace-rule">{attempt.rule}</span>
      <span className="mono probe-trace-url">
        {attempt.url ?? t('sources.probe.trace.noAddress')}
      </span>
      <span className="probe-trace-status">
        {attempt.httpStatus ?? t(`versions.status.${attempt.status}`)}
        {attempt.tookMs > 0 && ` · ${t('sources.probe.trace.took', { ms: attempt.tookMs })}`}
      </span>
      <span className="probe-trace-outcome">
        {attempt.version ?? (attempt.error ? t(attempt.error.code, attempt.error.params) : '—')}
      </span>
      {/* Said on the attempt that counts rather than left to be inferred from
          the order: the walk keeps the one that got furthest when nothing
          answered, which is not the last one tried. */}
      {attempt.filed && <span className="pill">{t('sources.probe.trace.filed')}</span>}
    </div>
  );
}

/** A declared environment belongs to no repo and is named on its own. */
function named(trace: VersionProbeTrace): string {
  return trace.repo ? `${trace.repo} · ${trace.environment}` : trace.environment;
}
