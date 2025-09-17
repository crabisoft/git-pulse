import type { DoraMetric, DoraResult, DoraSample, FailureSource } from '@repo/shared';

/** Most recent contributing events kept per result for the detail view. */
const MAX_SAMPLES = 50;

/** A deployment, already classified into dimensions by the env engine. */
export interface DeploymentEvent {
  environment: string;
  repo: string;
  status: 'success' | 'failed' | 'other';
  createdAt: string;
  dimensions: Record<string, string>;
}

/** An incident, already classified into dimensions from its labels. */
export interface IncidentEvent {
  key: string;
  title: string;
  url: string;
  openedAt: string;
  resolvedAt: string | null;
  repo?: string;
  dimensions: Record<string, string>;
}

/** A merged pull/merge request with the timestamps needed for lead time. */
export interface MergedPrEvent {
  repo: string;
  number: number;
  url: string;
  firstCommitAt: string | null;
  openedAt: string;
  firstReviewAt: string | null;
  mergedAt: string;
  dimensions: Record<string, string>;
}

/** Deployment count per dimension combination over the collected window. */
export function deploymentFrequency(deployments: DeploymentEvent[]): DoraResult[] {
  return [...groupByDimensions(deployments)].map(([, items]) => ({
    metric: 'deployment_frequency',
    value: items.length,
    unit: 'count',
    dimensions: items[0].dimensions,
    sampleSize: items.length,
    samples: takeRecent(items.map(deploymentSample)),
  }));
}

/**
 * Failures / deployments, per dimension combination. Deployments are always the
 * denominator — the rate answers "how many of our deployments went wrong" — but
 * what counts as a failure depends on `source`.
 *
 * Only slices that actually deployed produce a result: a ratio over an empty
 * denominator would be meaningless. Incidents landing in a slice with no
 * deployment are reported by the caller instead of being silently averaged in.
 */
export function changeFailureRate(
  deployments: DeploymentEvent[],
  incidents: IncidentEvent[],
  source: FailureSource,
): DoraResult[] {
  const known = deployments.filter((d) => d.status !== 'other');
  const incidentsByDimensions = groupByDimensions(incidents);

  return [...groupByDimensions(known)].map(([key, items]) => {
    const failedDeploys = source === 'incidents' ? [] : items.filter((d) => d.status === 'failed');
    const related = source === 'pipelines' ? [] : (incidentsByDimensions.get(key) ?? []);
    const failures = failedDeploys.length + related.length;
    return {
      metric: 'change_failure_rate',
      value: items.length ? failures / items.length : 0,
      unit: 'ratio',
      dimensions: items[0].dimensions,
      sampleSize: items.length,
      // Failures first: they are what the rate is about, and what a reader
      // opening the detail wants to see without scrolling past the successes.
      samples: takeRecent(
        [...related.map(incidentSample), ...items.map(deploymentSample)],
        (a, b) => (a.status === b.status ? 0 : a.status === 'failed' ? -1 : 1),
      ),
    };
  });
}

/** Dimension keys carrying incidents but no deployment to divide them by. */
export function orphanIncidentDimensions(
  deployments: DeploymentEvent[],
  incidents: IncidentEvent[],
): Record<string, string>[] {
  const deployed = new Set(groupByDimensions(deployments.filter((d) => d.status !== 'other')).keys());
  return [...groupByDimensions(incidents)]
    .filter(([key]) => !deployed.has(key))
    .map(([, items]) => items[0].dimensions);
}

/**
 * Median time to restore, per dimension combination. Two ways to measure it,
 * combined when `source` is `both`:
 *   pipelines — a failed deployment until the next success in the same environment
 *   incidents — an incident from opened to resolved
 *
 * Unlike the failure rate this needs no deployments at all, so a slice known
 * only through its incidents still yields a value.
 */
export function mttr(
  deployments: DeploymentEvent[],
  incidents: IncidentEvent[],
  source: FailureSource,
): DoraResult[] {
  const deploysByDimensions = source === 'incidents' ? new Map() : groupByDimensions(deployments);
  const incidentsByDimensions = source === 'pipelines' ? new Map() : groupByDimensions(incidents);

  const keys = new Set([...deploysByDimensions.keys(), ...incidentsByDimensions.keys()]);
  return [...keys].map((key) => {
    const deploys: DeploymentEvent[] = deploysByDimensions.get(key) ?? [];
    const related: IncidentEvent[] = incidentsByDimensions.get(key) ?? [];
    const restores: number[] = [];
    const samples: DoraSample[] = [];

    for (const [, envItems] of groupBy(deploys, (d) => d.environment)) {
      const sorted = [...envItems].sort(byCreatedAt);
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].status !== 'failed') continue;
        const next = sorted.slice(i + 1).find((d) => d.status === 'success');
        if (!next) continue;
        const durationSec = seconds(sorted[i].createdAt, next.createdAt);
        restores.push(durationSec);
        samples.push({
          label: sorted[i].environment,
          at: sorted[i].createdAt,
          value: durationSec,
          status: 'failed',
          details: { repo: sorted[i].repo, restoredAt: next.createdAt },
        });
      }
    }

    for (const incident of related) {
      // An incident still open has no restore time yet — it would drag the
      // median toward zero rather than upward, so it is left out entirely.
      if (!incident.resolvedAt) continue;
      const durationSec = clamp(seconds(incident.openedAt, incident.resolvedAt));
      restores.push(durationSec);
      samples.push({ ...incidentSample(incident), value: durationSec });
    }

    return {
      metric: 'mttr',
      value: median(restores),
      unit: 'seconds',
      dimensions: (deploys[0] ?? related[0]).dimensions,
      sampleSize: restores.length,
      samples: takeRecent(samples),
    };
  });
}

/**
 * Lead time and its decomposition, per dimension combination:
 *   coding = first commit → PR opened
 *   pickup = PR opened → first review
 *   review = first review → merge
 *   lead   = first commit → merge
 * All medians, in seconds.
 */
export function leadTimeBreakdown(prs: MergedPrEvent[]): DoraResult[] {
  return [...groupByDimensions(prs)].flatMap(([, items]) => {
    const coding: DoraSample[] = [];
    const pickup: DoraSample[] = [];
    const review: DoraSample[] = [];
    const lead: DoraSample[] = [];
    for (const p of items) {
      if (p.firstCommitAt) {
        coding.push(prSample(p, clamp(seconds(p.firstCommitAt, p.openedAt))));
        lead.push(prSample(p, clamp(seconds(p.firstCommitAt, p.mergedAt))));
      }
      if (p.firstReviewAt) {
        pickup.push(prSample(p, clamp(seconds(p.openedAt, p.firstReviewAt))));
        review.push(prSample(p, clamp(seconds(p.firstReviewAt, p.mergedAt))));
      }
    }
    const dims = items[0].dimensions;
    const point = (metric: DoraMetric, samples: DoraSample[]): DoraResult => ({
      metric,
      value: median(samples.map((s) => s.value ?? 0)),
      unit: 'seconds',
      dimensions: dims,
      sampleSize: samples.length,
      samples: takeRecent(samples),
    });
    return [
      point('coding_time', coding),
      point('pickup_time', pickup),
      point('review_time', review),
      point('lead_time', lead),
    ];
  });
}

// ─── helpers ─────────────────────────────────────────────────────────

function deploymentSample(d: DeploymentEvent): DoraSample {
  return {
    label: d.environment,
    at: d.createdAt,
    value: null,
    status: d.status,
    details: { repo: d.repo },
  };
}

function incidentSample(i: IncidentEvent): DoraSample {
  return {
    label: `${i.key} ${i.title}`,
    at: i.openedAt,
    value: null,
    // Reuses the deployment vocabulary so the failure-first sort in the change
    // failure rate orders incidents and failed deployments together.
    status: 'failed',
    url: i.url,
    details: {
      ...(i.repo ? { repo: i.repo } : {}),
      ...(i.resolvedAt ? { restoredAt: i.resolvedAt } : {}),
    },
  };
}

function prSample(p: MergedPrEvent, value: number): DoraSample {
  return {
    label: `${p.repo} #${p.number}`,
    at: p.mergedAt,
    value,
    url: p.url,
    details: { openedAt: p.openedAt },
  };
}

/** Most recent first — after an optional priority sort — capped to MAX_SAMPLES. */
function takeRecent(
  samples: DoraSample[],
  priority?: (a: DoraSample, b: DoraSample) => number,
): DoraSample[] {
  return [...samples]
    .sort((a, b) => (priority ? priority(a, b) : 0) || msOf(b.at) - msOf(a.at))
    .slice(0, MAX_SAMPLES);
}

function msOf(date: string): number {
  return new Date(date).getTime();
}

function groupByDimensions<T extends { dimensions: Record<string, string> }>(items: T[]) {
  return groupBy(items, (i) => dimensionKey(i.dimensions));
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function dimensionKey(dimensions: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(dimensions).sort()) sorted[k] = dimensions[k];
  return JSON.stringify(sorted);
}

function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function seconds(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 1000;
}

function clamp(value: number): number {
  return value < 0 ? 0 : value;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
