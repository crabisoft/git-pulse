import { Module } from '@nestjs/common';
import { ReleaseNotesService } from './release-notes.service';
import { ReleaseNotesController } from './release-notes.controller';
import { SourcesModule } from '../sources/sources.module';
import { TicketRulesModule } from '../ticket-rules/ticket-rules.module';
import { LlmModule } from '../llm/llm.module';
import { IngestModule } from '../ingest/ingest.module';

@Module({
  imports: [SourcesModule, TicketRulesModule, LlmModule, IngestModule],
  controllers: [ReleaseNotesController],
  providers: [ReleaseNotesService],
  exports: [ReleaseNotesService],
})
export class ReleaseNotesModule {}
