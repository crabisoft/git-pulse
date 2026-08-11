import type { DoraMetric, DoraResult, DoraSample, FailureSource, TicketRef } from '@repo/shared';

/** Most recent contributing events kept per result for the detail view. */
const MAX_SAMPLES = 50;

/**
 * A reading, with the population it was computed on.
 *
 * Server-side only: `population` is never persisted and never crosses the wire
 * whole — the snapshots name their columns, and the fold builds a fresh object.
 * It earns its keep twice: folding several combinations takes a median of
 * everything measured rather than a mean of the medians, and a reader paging
 * through the events gets all of them rather than the most recent handful.
 */
export interface MeasuredResult extends DoraResult {
  /**
   * Every event behind the reading. `samples` is a window on this — the most
   * recent few, for a page that shows a list without paging through it.
   */
  population: DoraSample[];
}

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
  /** Tickets it mentions — the handle onto the change that caused it. */
  tickets: TicketRef[];
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
  /** Tickets the PR references, surfaced in the detail view. */
  tickets: TicketRef[];
  dimensions: Record<string, string>;
}

/**
 * Successful deployments **per day**, per dimension combination.
 *
 * A rate rather than a count over the window, because a count is only readable
 * beside the window it was taken over — and a historised one has no window
 * attached at all. Raising `doraWindowDays` from 30 to 90 used to triple the
 * whole series without a single extra deployment, and the DORA scale, which is
 * published per day, could only be applied by whoever still remembered the
 * length to divide by.
 *
 * Successes only. A deployment that failed delivered nothing — the same reason
 * the correlation refuses to let one carry a change — and one whose status
 * could not be read is not evidence of anything. The failure rate keeps
 * counting both in its denominator, which is a different question: how many of
 * the deployments we attempted went wrong.
 */
export function deploymentFrequency(deployments: DeploymentEvent[], days: number): DoraResult[] {
  // No span to divide by, no rate. It takes an explicit period whose bounds are
  // the same instant, and answering with the raw count would be the reading the
  // whole metric is moving away from.
  if (days <= 0) return [];

  return [...groupByDimensions(deployments.filter((d) => d.status === 'success'))].map(
    ([, items]) => ({
      metric: 'deployment_frequency',
      value: items.length / days,
      unit: 'per_day',
      dimensions: items[0].dimensions,
      sampleSize: items.length,
      samples: takeRecent(items.map(deploymentSample)),
    }),
  );
}

/**
 * Ties each incident to the deployment that caused it, when the trail exists:
 * the incident mentions a ticket, a merged pull request mentions the same one,
 * and that request was carried by a deployment opened before the incident.
 *
 * This is what DORA actually asks of a change failure rate — deployments that
 * broke something — where matching on dimensions alone only asks whether a
 * failure happened in the same slice. Incidents with no ticket in common fall
 * back to that slice, so nothing is lost while the rules are still thin.
 *
 * The component narrows which deployment carried the request, so blame follows
 * it: in a monorepo, an incident traced to a front-end change is counted
 * against the front-end release rather than against whatever shipped next.
 */
export function incidentsByDeployment(
  incidents: IncidentEvent[],
  prs: MergedPrEvent[],
  carriers: Carriers,
): Map<DeploymentEvent, IncidentEvent[]> {
  const carrier = new Map<string, DeploymentEvent>();
  for (const pr of prs) {
    const deployment = deploymentCarrying(pr, carriers);
    if (!deployment) continue;
    for (const ticket of pr.tickets) carrier.set(ticketKey(ticket), deployment);
  }

  const linked = new Map<DeploymentEvent, IncidentEvent[]>();
  for (const incident of incidents) {
    for (const ticket of incident.tickets) {
      const deployment = carrier.get(ticketKey(ticket));
      // A deployment that happened *after* the incident cannot have caused it.
      if (!deployment || msOf(deployment.createdAt) > msOf(incident.openedAt)) continue;
      const bucket = linked.get(deployment);
      if (bucket) {
        if (!bucket.includes(incident)) bucket.push(incident);
      } else {
        linked.set(deployment, [incident]);
      }
      break;
    }
  }
  return linked;
}

/**
 * Failures / deployments, per dimension combination. Deployments are always the
 * denominator — the rate answers "how many of our deployments went wrong" — but
 * what counts as a failure depends on `source`.
 *
 * An incident traced to a deployment is counted against that deployment's
 * slice, whichever dimensions it carries itself; the rest fall back to their
 * own slice. Only slices that actually deployed produce a result: a ratio over
 * an empty denominator would be meaningless, and incidents landing in one are
 * reported by the caller instead of being silently averaged in.
 */
export function changeFailureRate(
  deployments: DeploymentEvent[],
  incidents: IncidentEvent[],
  source: FailureSource,
  /** Omitted, every incident falls back to matching on dimensions. */
  linked: Map<DeploymentEvent, IncidentEvent[]> = new Map(),
): DoraResult[] {
  const known = deployments.filter((d) => d.status !== 'other');
  const attributed = new Set([...linked.values()].flat());
  const unattributed = incidents.filter((i) => !attributed.has(i));
  const incidentsByDimensions = groupByDimensions(unattributed);

  return [...groupByDimensions(known)].map(([key, items]) => {
    const failedDeploys = source === 'incidents' ? [] : items.filter((d) => d.status === 'failed');
    const related =
      source === 'pipelines'
        ? []
        : [
            ...items.flatMap((d) => linked.get(d) ?? []),
            ...(incidentsByDimensions.get(key) ?? []),
          ];
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
  /** Incidents already tied to a deployment need no slice of their own. */
  linked: Map<DeploymentEvent, IncidentEvent[]> = new Map(),
): Record<string, string>[] {
  const attributed = new Set([...linked.values()].flat());
  const deployed = new Set(groupByDimensions(deployments.filter((d) => d.status !== 'other')).keys());
  return [...groupByDimensions(incidents.filter((i) => !attributed.has(i)))]
    .filter(([key]) => !deployed.has(key))
    .map(([, items]) => items[0].dimensions);
}

/**
 * Median time to restore, per dimension combination. Two ways to measure it,
 * combined when `source` is `both`:
 *   pipelines — a failed deployment until the next success of the same
 *               deployable, meaning the same repository *and* environment
 *   incidents — an incident from opened to resolved
 *
 * Unlike the failure rate this needs no deployments at all, so a slice known
 * only through its incidents still yields a value.
 *
 * A slice with nothing to measure yields none: see `measured`.
 */
export function mttr(
  deployments: DeploymentEvent[],
  incidents: IncidentEvent[],
  source: FailureSource,
  /** Same attribution as the failure rate, so both read the same incidents. */
  linked: Map<DeploymentEvent, IncidentEvent[]> = new Map(),
): DoraResult[] {
  const attributed = new Set([...linked.values()].flat());
  const deploysByDimensions = source === 'incidents' ? new Map() : groupByDimensions(deployments);
  const incidentsByDimensions =
    source === 'pipelines'
      ? new Map()
      : groupByDimensions(incidents.filter((i) => !attributed.has(i)));

  const keys = new Set([...deploysByDimensions.keys(), ...incidentsByDimensions.keys()]);
  return [...keys].flatMap((key) => {
    const deploys: DeploymentEvent[] = deploysByDimensions.get(key) ?? [];
    const related: IncidentEvent[] =
      source === 'pipelines'
        ? []
        : [...deploys.flatMap((d) => linked.get(d) ?? []), ...(incidentsByDimensions.get(key) ?? [])];
    const samples: DoraSample[] = [];

    // Repository *and* environment. On the environment alone, two repos
    // shipping to a shared name interleave, and one repo's success closes
    // another's failure: `portal-api` breaks production, `portal-front` deploys
    // ten minutes later, and the pair reads as a ten-minute restore of
    // something nobody fixed. A restore is the same deployable recovering.
    for (const [, envItems] of groupBy(deploys, (d) => `${d.repo}\u0000${d.environment}`)) {
      const sorted = [...envItems].sort(byCreatedAt);
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].status !== 'failed') continue;
        const next = sorted.slice(i + 1).find((d) => d.status === 'success');
        if (!next) continue;
        const durationSec = seconds(sorted[i].createdAt, next.createdAt);
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
      samples.push({ ...incidentSample(incident), value: durationSec });
    }

    return measured('mttr', (deploys[0] ?? related[0]).dimensions, samples);
  });
}

/**
 * Every merged request paired with the deployments that carried it — one per
 * environment the change reached, and no entry at all for a request that
 * reached nowhere.
 *
 * Computed once and read by the three things that need it: `deployTime`
 * measures each landing, `deploymentCarrying` takes the first of them for
 * blame, and `componentMismatches` compares it against the same correlation
 * run without the component test. Each of those used to walk every deployment
 * for every pull request on its own — four passes of `O(requests ×
 * deployments)` per computation, and a computation happens once per trend
 * slice and once per replayed day.
 */
export type Carriers = Map<MergedPrEvent, DeploymentEvent[]>;

/**
 * The first deployment to carry a merged pull request **to each environment**.
 *
 * One per environment, because reaching pre-production and reaching production
 * are two different measurements. Taking the earliest deployment outright
 * reported whichever came first and filed it under that environment's
 * dimensions — so on a repo that stages before it ships, `type=Prod` answered
 * with the handful of pull requests whose first landing happened to be
 * production, and called it the time to production.
 *
 * Correlation is by repository and time. The connectors expose a deployment's
 * ref, never the commits it contains, so time is the only signal available: a
 * PR merged just before a deployment that did not include it is attributed to
 * it anyway. Read `deploy_time` as an upper bound on how quickly changes reach
 * an environment, not as a per-commit truth.
 *
 * `componentKey` narrows it further where one repo holds several deployables.
 * The repo is a constant in a monorepo, so on its own it pairs a request that
 * touched the front with whichever component happened to deploy first — an
 * upper bound on nothing, since it measures another component's release.
 */
export function carriedBy(
  prs: MergedPrEvent[],
  deployments: DeploymentEvent[],
  componentKey: string | null = null,
): Carriers {
  const timeline = successTimeline(deployments, componentKey);
  const carriers: Carriers = new Map();

  for (const pr of prs) {
    const environments = timeline.get(pr.repo);
    if (!environments) continue;
    const mergedAt = msOf(pr.mergedAt);
    const component = componentKey ? pr.dimensions[componentKey] : undefined;
    const landings: DeploymentEvent[] = [];

    for (const environment of environments.values()) {
      const landing =
        component === undefined
          ? // Nothing to narrow on: the whole environment, as it always was.
            firstAfter(environment.all, mergedAt)
          : // The releases of that component, and those naming none — the
            // silence rule of `sameComponent`, read as a lookup rather than
            // walked past.
            earlier(
              firstAfter(environment.byComponent.get(component) ?? [], mergedAt),
              firstAfter(environment.silent, mergedAt),
            );
      if (landing) landings.push(landing.deployment);
    }

    if (landings.length > 0) carriers.set(pr, landings);
  }
  return carriers;
}

/**
 * Whether a request and a deployment speak of the same deployable.
 *
 * True wherever the question does not arise: no component attribute configured,
 * or one of the two silent about it. Deliberately **not** treating silence as a
 * wildcard match against a stated value either — it is a fallback onto repository
 * and time, which is what the correlation did before any of this existed.
 *
 * That is what lets one install hold a monorepo and a dozen ordinary repos with
 * nothing to declare: the rules produce the attribute where they were written
 * to, and the pairs that carry it on both sides are the only ones narrowed.
 * A half-written rule set therefore degrades to the old behaviour rather than
 * to an empty metric.
 */
function sameComponent(
  componentKey: string | null,
  pr: Record<string, string>,
  deployment: Record<string, string>,
): boolean {
  if (!componentKey) return true;
  const left = pr[componentKey];
  const right = deployment[componentKey];
  if (left === undefined || right === undefined) return true;
  return left === right;
}

/** A deployment with its date already parsed — the loops below only compare. */
interface TimedDeployment {
  at: number;
  deployment: DeploymentEvent;
}

/** One environment of one repository, in the orders the correlation reads. */
interface EnvironmentTimeline {
  /** Every success, oldest first. What a request with no component to state reads. */
  all: TimedDeployment[];
  /** Successes stating a deployable, per value, oldest first. */
  byComponent: Map<string, TimedDeployment[]>;
  /** Successes stating none: by the silence rule they pair with any request. */
  silent: TimedDeployment[];
}

/**
 * Successful deployments indexed for the one question the correlation asks:
 * what did this repository first ship to each of its environments after a
 * given instant.
 *
 * Sorted per repository and environment, so that question is a binary search
 * instead of a walk over every deployment. It was walked once per pull request
 * and per caller before, which a trend redoes for each of its slices and a
 * replay for each of its ninety days — over events read once and never
 * changing between them.
 *
 * The component lists are the second half of it. Scanning forward from the
 * merge until a matching deployable turns up is linear again exactly where the
 * setting exists to help — a monorepo, where a component's own releases are
 * sparse among the others. Indexing each environment a second time by the value
 * stated, plus the successes stating none, turns `sameComponent` into two
 * lookups. Built only when a deployable is designated: without one, nothing
 * states a component and the extra maps would index nothing.
 */
function successTimeline(
  deployments: DeploymentEvent[],
  componentKey: string | null,
): Map<string, Map<string, EnvironmentTimeline>> {
  const byRepo = new Map<string, Map<string, EnvironmentTimeline>>();

  for (const deployment of deployments) {
    if (deployment.status !== 'success') continue;
    let environments = byRepo.get(deployment.repo);
    if (!environments) byRepo.set(deployment.repo, (environments = new Map()));
    let timeline = environments.get(deployment.environment);
    if (!timeline) {
      environments.set(
        deployment.environment,
        (timeline = { all: [], byComponent: new Map(), silent: [] }),
      );
    }

    const timed = { at: msOf(deployment.createdAt), deployment };
    timeline.all.push(timed);
    if (!componentKey) continue;
    const component = deployment.dimensions[componentKey];
    if (component === undefined) timeline.silent.push(timed);
    else {
      const stated = timeline.byComponent.get(component);
      if (stated) stated.push(timed);
      else timeline.byComponent.set(component, [timed]);
    }
  }

  for (const environments of byRepo.values()) {
    for (const timeline of environments.values()) {
      timeline.all.sort(byTime);
      timeline.silent.sort(byTime);
      for (const stated of timeline.byComponent.values()) stated.sort(byTime);
    }
  }
  return byRepo;
}

function byTime(a: TimedDeployment, b: TimedDeployment): number {
  return a.at - b.at;
}

/** The oldest deployment of a sorted run that is not older than `at`. */
function firstAfter(sorted: TimedDeployment[], at: number): TimedDeployment | null {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid].at < at) low = mid + 1;
    else high = mid;
  }
  return sorted[low] ?? null;
}

function earlier(a: TimedDeployment | null, b: TimedDeployment | null): TimedDeployment | null {
  if (!a) return b;
  if (!b) return a;
  return a.at <= b.at ? a : b;
}

/**
 * Repo and component of every request the component test left with nothing,
 * where repository and time alone would have found a deployment.
 *
 * The one way this can go wrong: both sides state a component and they disagree
 * — `component=api` extracted from environment names, `component=backend` from
 * labels. The fallback above cannot fire, since neither side is silent, and
 * `deploy_time` empties for that repo without saying why. Reported for the same
 * reason orphan incident combinations are: a metric that goes missing is worth
 * a line in the log, and the fix is one rule away once it is named.
 */
export function componentMismatches(
  prs: MergedPrEvent[],
  carriers: Carriers,
  /** The same correlation with the component test off: repository and time. */
  byRepoAndTime: Carriers,
  componentKey: string | null,
): Array<{ repo: string; component: string }> {
  if (!componentKey) return [];
  const found = new Map<string, { repo: string; component: string }>();
  for (const pr of prs) {
    const component = pr.dimensions[componentKey];
    if (component === undefined) continue;
    if (carriers.has(pr)) continue;
    if (!byRepoAndTime.has(pr)) continue;
    found.set(`${pr.repo}\u0000${component}`, { repo: pr.repo, component });
  }
  return [...found.values()];
}

/**
 * The very first place a change landed, whichever environment that was.
 *
 * What blame attribution needs — an incident is tied to the deployment that
 * put the change in the world — as opposed to the correlation itself, which
 * measures each destination separately.
 */
export function deploymentCarrying(pr: MergedPrEvent, carriers: Carriers): DeploymentEvent | null {
  return (carriers.get(pr) ?? []).reduce<DeploymentEvent | null>(
    (earliest, d) => (!earliest || msOf(d.createdAt) < msOf(earliest.createdAt) ? d : earliest),
    null,
  );
}

/**
 * Lead time and its decomposition, per dimension combination:
 *   coding = first commit → PR opened
 *   pickup = PR opened → first review
 *   review = first review → merge
 *   lead   = first commit → merge
 * All medians, in seconds.
 *
 * A segment nothing could be measured on is absent rather than zero — a
 * platform with no review object leaves `pickup_time` and `review_time`
 * unanswered, not instant. See `measured`.
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
    return [
      ...measured('coding_time', dims, coding),
      ...measured('pickup_time', dims, pickup),
      ...measured('review_time', dims, review),
      ...measured('lead_time', dims, lead),
    ];
  });
}

/**
 * Merge → the deployment that carried it, the fourth segment of the lead time.
 *
 * Grouped by the **deployment's** dimensions rather than the pull request's:
 * how long a change takes to reach somewhere is a property of where it lands,
 * so slicing on `type=Prod` answers "time to production" with no extra setting.
 * Which only holds because each destination is measured on its own — see
 * `carriedBy`. A pull request that lands in two environments
 * contributes a sample to each, so the sample sizes here count landings rather
 * than pull requests.
 */
export function deployTime(prs: MergedPrEvent[], carriers: Carriers): DoraResult[] {
  const samplesByKey = new Map<string, { dimensions: Record<string, string>; samples: DoraSample[] }>();

  for (const pr of prs) {
    // One sample per environment the change reached: a pull request that goes
    // to pre-production and then to production took two different times, and
    // both are worth a reading.
    for (const deployment of carriers.get(pr) ?? []) {
      const key = dimensionKey(deployment.dimensions);
      const bucket = samplesByKey.get(key) ?? { dimensions: deployment.dimensions, samples: [] };
      bucket.samples.push({
        ...prSample(pr, clamp(seconds(pr.mergedAt, deployment.createdAt))),
        details: {
          openedAt: pr.openedAt,
          environment: deployment.environment,
          deployedAt: deployment.createdAt,
        },
      });
      samplesByKey.set(key, bucket);
    }
  }

  return [...samplesByKey.values()].flatMap(({ dimensions, samples }) =>
    measured('deploy_time', dimensions, samples),
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * A duration reading over the events it was measured on — or no reading at all.
 *
 * The empty case is why this exists. `median([])` is 0, and zero is not the
 * absence of a measurement: it folds in with the real slices, the scheduled
 * snapshot persists it as a genuine reading, the trend draws a point on it, and
 * `doraTier` ranks it **elite** — a restore time nobody could measure reading
 * as the best recovery on the scale. A slice with nothing to measure therefore
 * produces nothing, which every reader already handles: a metric with no result
 * gets no card, no snapshot row, and no point on its line.
 */
function measured(
  metric: DoraMetric,
  dimensions: Record<string, string>,
  samples: DoraSample[],
): MeasuredResult[] {
  if (samples.length === 0) return [];
  return [
    {
      metric,
      value: median(samples.map((s) => s.value ?? 0)),
      unit: 'seconds',
      dimensions,
      sampleSize: samples.length,
      samples: takeRecent(samples),
      population: samples,
    },
  ];
}

/** Two references mean the same ticket when tracker and key agree. */
function ticketKey(ticket: TicketRef): string {
  return `${ticket.tracker.id}:${ticket.key}`;
}

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
    details: {
      openedAt: p.openedAt,
      ...(p.tickets.length > 0 ? { tickets: p.tickets.map((t) => t.key).join(', ') } : {}),
    },
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

/** Shared with the fold, which takes one over every combination at once. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
