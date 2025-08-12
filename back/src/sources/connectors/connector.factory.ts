import { Injectable, HttpStatus } from '@nestjs/common';
import type { SourceKind } from '@repo/shared';
import { CodedException } from '../../common/coded-exception';
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
        throw new CodedException('errors.source.unsupportedKind', HttpStatus.BAD_REQUEST, { kind });
    }
  }
}
