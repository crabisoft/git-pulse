import { Injectable, HttpStatus } from '@nestjs/common';
import type { TrackerKind } from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import type { IncidentProvider } from './incident-provider.interface';
import { GitHubIncidentProvider } from './github.incident-provider';
import { GitLabIncidentProvider } from './gitlab.incident-provider';

/**
 * Resolves the incident provider of a tracker. Jira and Linear are declarable
 * as trackers — for ticket links — long before they can supply incidents, so
 * they are rejected here rather than assumed absent. `SourcesService` refuses
 * to designate one, which is where a user gets a legible message.
 */
@Injectable()
export class IncidentProviderFactory {
  constructor(
    private readonly github: GitHubIncidentProvider,
    private readonly gitlab: GitLabIncidentProvider,
  ) {}

  for(kind: TrackerKind): IncidentProvider {
    switch (kind) {
      case 'github':
        return this.github;
      case 'gitlab':
        return this.gitlab;
      default:
        throw new CodedException('errors.source.incidentTrackerUnsupported', HttpStatus.BAD_REQUEST, {
          kind,
        });
    }
  }
}
