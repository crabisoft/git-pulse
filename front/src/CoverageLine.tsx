import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { CoverageSpan, SourceCoverage } from '@repo/shared';
import { HelpTip } from './HelpTip';

/**
 * How much history a source actually has, next to how much it was asked for.
 *
 * Two figures on the row and the rest behind the tip: what is read at a glance
 * is whether the store goes as deep as the depth claims, and whether the DORA
 * readings go back at all. Which of the three tables is the shallow one is a
 * diagnosis, and a diagnosis is not what a list is scanned for.
 *
 * The two are stated apart because different things fill them: the store is
 * ingested to the configured depth, while the readings are historized by the
 * collection and therefore start the day the install did — a store holding a
 * year of deployments still has a fortnight of curves.
 */
export function CoverageLine({ coverage }: { coverage: SourceCoverage }) {
  const { t } = useTranslation();
  const store = deepest(coverage);
  /** Below the depth it claims — the case the line exists to make visible. */
  const short = coverage.depthDays !== null && store !== null && store < coverage.depthDays;

  return (
    <div className="source-coverage">
      {coverage.depthDays !== null && (
        <span>{t('sources.coverage.depth', { days: coverage.depthDays })}</span>
      )}
      <span className={short ? 'short' : undefined}>
        {store === null
          ? t('sources.coverage.storeEmpty')
          : t('sources.coverage.store', { days: store })}
      </span>
      <span>
        {coverage.metrics.days === null
          ? t('sources.coverage.metricsEmpty')
          : t('sources.coverage.metrics', { days: coverage.metrics.days })}
      </span>
      <HelpTip text={detail(t, coverage)} />
    </div>
  );
}

/**
 * The deepest of the stored tables — what the source can report over.
 *
 * The deepest and not the shallowest: the tables answer different questions and
 * are not filled in step. A source deploying weekly holds fewer deployments
 * than pipelines over the same period, and reading the smallest of the three as
 * "the history" would understate it on every install.
 */
export function deepest(coverage: SourceCoverage): number | null {
  const days = [coverage.deployments, coverage.pullRequests, coverage.pipelines]
    .map((span) => span.days)
    .filter((value): value is number => value !== null);
  return days.length === 0 ? null : Math.max(...days);
}

/** Table by table, plus what the sweep will take back. */
function detail(t: TFunction, coverage: SourceCoverage): string {
  const lines = [
    t('sources.coverage.explain'),
    line(t, t('sources.coverage.deployments'), coverage.deployments),
    line(t, t('sources.coverage.pullRequests'), coverage.pullRequests),
    line(t, t('sources.coverage.pipelines'), coverage.pipelines),
    line(t, t('sources.coverage.metricsLabel'), coverage.metrics),
  ];
  // Only where there is a sweep to speak of: a live source stores nothing for
  // one to take back.
  if (coverage.retainedDays !== null) {
    lines.push(t('sources.coverage.swept', { days: coverage.retainedDays }));
  }
  return lines.join('\n');
}

function line(t: TFunction, label: string, span: CoverageSpan): string {
  if (span.days === null) return `${label} : ${t('sources.coverage.none')}`;
  // `rows` and not `count`: i18next reads a `count` as a plural selector and
  // would go looking for keys that do not exist.
  return `${label} : ${t('sources.coverage.spanDays', {
    days: span.days,
    from: formatDay(span.from),
    rows: span.count,
  })}`;
}

/** The day alone: an hour is never what a history is read to the precision of. */
function formatDay(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}
