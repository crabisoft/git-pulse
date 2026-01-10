import { Module } from '@nestjs/common';
import { IncidentProviderFactory } from './incident-provider.factory';
import { GitHubIncidentProvider } from './github.incident-provider';
import { GitLabIncidentProvider } from './gitlab.incident-provider';
import { IncidentsService } from './incidents.service';
import { IncidentsController } from './incidents.controller';
import { SourcesModule } from '../sources/sources.module';
import { TrackersModule } from '../trackers/trackers.module';

@Module({
  imports: [SourcesModule, TrackersModule],
  controllers: [IncidentsController],
  providers: [IncidentProviderFactory, GitHubIncidentProvider, GitLabIncidentProvider, IncidentsService],
  exports: [IncidentProviderFactory, IncidentsService],
})
export class IncidentsModule {}
