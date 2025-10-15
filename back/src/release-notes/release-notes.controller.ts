import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReleaseNotesService } from './release-notes.service';
import { abortOnDisconnect } from '../common/request-abort';
import { GenerateReleaseNotesDto } from './dto/generate-release-notes.dto';
import { ListTagsDto } from './dto/list-tags.dto';

@Controller()
export class ReleaseNotesController {
  constructor(private readonly releaseNotes: ReleaseNotesService) {}

  /** Tags of a repo, for whoever picks the range. */
  @Get('sources/:id/tags')
  tags(
    @Param('id') id: string,
    @Query() query: ListTagsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.releaseNotes.tags(id, query.repo, abortOnDisconnect(res));
  }

  @Get('sources/:id/release-notes')
  generate(
    @Param('id') id: string,
    @Query() query: GenerateReleaseNotesDto,
    // Walking a history is as expensive as the DORA collection: the same
    // hang-up handling applies.
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.releaseNotes.generate(id, query, abortOnDisconnect(res));
  }
}
