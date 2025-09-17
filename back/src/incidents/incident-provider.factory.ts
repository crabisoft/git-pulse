import { Injectable, HttpStatus } from '@nestjs/common';
import type { SourceKind } from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import type { IncidentProvider } from './incident-provider.interface';
import { GitHubIncidentProvider } from './github.incident-provider';
import { GitLabIncidentProvider } from './gitlab.incident-provider';

/**
 * Resolves the incident provider for a source. Keyed on `SourceKind` while
 * every tracker is the Git platform itself; a standalone tracker will be picked
 * by its own kind instead, which is why callers go through the factory rather
 * than reaching for a provider directly.
 */
@Injectable()
export class IncidentProviderFactory {
  constructor(
    private readonly github: GitHubIncidentProvider,
    private readonly gitlab: GitLabIncidentProvider,
  ) {}

  for(kind: SourceKind): IncidentProvider {
    switch (kind) {
      case 'github':
        return this.github;
      case 'gitlab':
        return this.gitlab;
      default:
        throw new CodedException('errors.source.unsupportedKind', HttpStatus.BAD_REQUEST, { kind });
    }
  }
}
