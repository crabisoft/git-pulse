import { Module } from '@nestjs/common';
import { IncidentProviderFactory } from './incident-provider.factory';
import { GitHubIncidentProvider } from './github.incident-provider';
import { GitLabIncidentProvider } from './gitlab.incident-provider';

@Module({
  providers: [IncidentProviderFactory, GitHubIncidentProvider, GitLabIncidentProvider],
  exports: [IncidentProviderFactory],
})
export class IncidentsModule {}
