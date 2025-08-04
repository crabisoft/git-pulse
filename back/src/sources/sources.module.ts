import { Module } from '@nestjs/common';
import { SourcesService } from './sources.service';
import { SourcesController } from './sources.controller';
import { ConnectorFactory } from './connectors/connector.factory';
import { GitHubConnector } from './connectors/github.connector';
import { GitLabConnector } from './connectors/gitlab.connector';

@Module({
  controllers: [SourcesController],
  providers: [SourcesService, ConnectorFactory, GitHubConnector, GitLabConnector],
  exports: [SourcesService, ConnectorFactory],
})
export class SourcesModule {}
