import { Injectable, BadRequestException } from '@nestjs/common';
import type { SourceKind } from '@repo/shared';
import type { SourceConnector } from './source-connector.interface';
import { GitHubConnector } from './github.connector';
import { GitLabConnector } from './gitlab.connector';

/** Resolves the connector matching a source kind. */
@Injectable()
export class ConnectorFactory {
  constructor(
    private readonly github: GitHubConnector,
    private readonly gitlab: GitLabConnector,
  ) {}

  for(kind: SourceKind): SourceConnector {
    switch (kind) {
      case 'github':
        return this.github;
      case 'gitlab':
        return this.gitlab;
      default:
        throw new BadRequestException(`Type de source non supporté : ${kind}`);
    }
  }
}
