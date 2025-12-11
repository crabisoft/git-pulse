import { Module } from '@nestjs/common';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { SourcesModule } from '../sources/sources.module';
import { IngestModule } from '../ingest/ingest.module';
import { EnvRulesModule } from '../env-rules/env-rules.module';
import { ReleaseNotesModule } from '../release-notes/release-notes.module';

/**
 * The deployments view: the rows, and what each one carried.
 *
 * It borrows the release-notes module rather than reading commits itself — what
 * a ref carries over another one is the same reading of the same commit
 * messages, and two readings would drift apart.
 */
@Module({
  imports: [SourcesModule, IngestModule, EnvRulesModule, ReleaseNotesModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService],
})
export class DeploymentsModule {}
