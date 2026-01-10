import { Injectable, Logger } from '@nestjs/common';
import type { Incident } from '@repo/shared';
import { SourcesService } from '../sources/sources.service';
import { TrackersService } from '../trackers/trackers.service';
import { SettingsService } from '../settings/settings.service';
import { throwIfAborted } from '../common/request-abort';
import { IncidentProviderFactory } from './incident-provider.factory';

/** Explicit reporting period; both bounds are ISO strings. */
export interface IncidentRange {
  from: string;
  to: string;
}

/**
 * Incidents, read rather than counted.
 *
 * DORA already collects these to divide deployments by failures. This reads
 * the same trail for its own sake — a timeline where an incident sits twenty
 * minutes after a release says something no rate can.
 *
 * Kept out of the overview's own round trip: incidents live in a tracker, on
 * another platform, with a budget of its own. Only the view that shows them
 * pays for them.
 */
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly sources: SourcesService,
    private readonly trackers: TrackersService,
    private readonly providers: IncidentProviderFactory,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Incidents opened or updated over the period, most recently opened first.
   *
   * Empty rather than an error in every case where the install has not set
   * incidents up: no tracker designated, or no label to tell an incident from
   * any other issue. Neither is a failure — it is a source that has not been
   * configured for this, and a timeline of deployments alone is still a
   * timeline.
   */
  async list(
    sourceId: string,
    range: IncidentRange,
    repos: string[] = [],
    signal?: AbortSignal,
  ): Promise<Incident[]> {
    const { incidentLabels } = await this.settings.get();
    if (incidentLabels.length === 0) return [];

    // Which tracker the incidents come from is a property of the source, not
    // of its Git platform: a GitHub org may well file its incidents elsewhere.
    const tracker = await this.trackers.incidentTrackerFor(sourceId);
    if (!tracker) return [];

    // A git-hosted tracker borrows this source's credentials, so nothing is
    // decrypted until one is actually in play.
    const { ctx } = await this.sources.resolveContext(sourceId, signal);

    try {
      const incidents = await this.providers
        .for(tracker.kind)
        .listIncidents({ access: ctx, repos, labels: incidentLabels }, range);
      return [...incidents].sort((a, b) => msOf(b.openedAt) - msOf(a.openedAt));
    } catch (e) {
      throwIfAborted(signal);
      // Degraded rather than fatal, like every other listing behind a page:
      // one missing permission on the tracker must not empty the screen.
      this.logger.warn(`listIncidents échoué (${sourceId}) : ${asMessage(e)}`);
      return [];
    }
  }
}

function msOf(date: string): number {
  return new Date(date).getTime();
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
