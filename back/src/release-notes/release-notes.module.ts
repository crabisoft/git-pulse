import { Module } from '@nestjs/common';
import { ReleaseNotesService } from './release-notes.service';
import { ReleaseNotesController } from './release-notes.controller';
import { SourcesModule } from '../sources/sources.module';
import { TicketRulesModule } from '../ticket-rules/ticket-rules.module';

@Module({
  imports: [SourcesModule, TicketRulesModule],
  controllers: [ReleaseNotesController],
  providers: [ReleaseNotesService],
  exports: [ReleaseNotesService],
})
export class ReleaseNotesModule {}
