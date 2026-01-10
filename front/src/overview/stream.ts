import type { Incident, OverviewEvent, PipelineStatus } from '@repo/shared';

/**
 * One line of the timeline, whatever it came from.
 *
 * A deployment and an incident are different records on different platforms,
 * and the whole point of this view is that they belong on the same rail: an
 * incident twenty minutes after a release is a sentence neither source tells
 * on its own.
 */
export interface StreamEntry {
  id: string;
  at: string;
  kind: 'deploy' | 'failure' | 'incident' | 'resolved';
  title: string;
  /** Secondary line — the repo, the ref, how long a restore took. */
  detail: string;
  url: string | null;
  attributes: Record<string, string>;
}

/**
 * Deployments and incidents on one rail, most recent first.
 *
 * An incident yields up to two entries: it opened, and — if it is over — it
 * was resolved. Both are moments on the timeline, and collapsing them into one
 * would put the resolution at the time of the breakage.
 */
export function toStream(events: OverviewEvent[], incidents: Incident[]): StreamEntry[] {
  const fromDeployments = events.map((event) => ({
    id: `deploy:${event.environment}:${event.at}`,
    at: event.at,
    kind: failed(event.status) ? ('failure' as const) : ('deploy' as const),
    title: event.environment,
    detail: `${event.repo} · ${event.ref}`,
    url: null,
    attributes: event.attributes,
  }));

  const fromIncidents = incidents.flatMap((incident) => {
    const opened: StreamEntry = {
      id: `incident:${incident.id}`,
      at: incident.openedAt,
      kind: 'incident',
      title: `${incident.key} — ${incident.title}`,
      detail: incident.repo ?? incident.labels.join(' · '),
      url: incident.url,
      // Incidents carry labels, not an environment; the labels are classified
      // by their own rules, which is what lets a filter reach them at all.
      attributes: {},
    };
    if (!incident.resolvedAt) return [opened];
    return [
      opened,
      {
        ...opened,
        id: `resolved:${incident.id}`,
        at: incident.resolvedAt,
        kind: 'resolved' as const,
        detail: durationLabel(incident.openedAt, incident.resolvedAt),
      },
    ];
  });

  return [...fromDeployments, ...fromIncidents].sort((a, b) => msOf(b.at) - msOf(a.at));
}

/** Local calendar day of an entry — what the day separators are drawn from. */
export function dayOf(iso: string): string {
  const at = new Date(iso);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function failed(status: PipelineStatus): boolean {
  return status === 'failed';
}

function durationLabel(from: string, to: string): string {
  const minutes = Math.max(0, Math.round((msOf(to) - msOf(from)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

function msOf(date: string): number {
  return new Date(date).getTime();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
