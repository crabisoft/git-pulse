import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReleaseNotesService } from './release-notes.service';
import { abortOnDisconnect } from '../common/request-abort';
import { GenerateReleaseNotesDto } from './dto/generate-release-notes.dto';
import { RepoQueryDto } from './dto/repo-query.dto';
import { RewriteReleaseNotesDto } from './dto/rewrite-release-notes.dto';
import { Account, Viewer } from '../auth/access.decorator';

/** Reporting over the same data the dashboard shows, so it follows it. */
@Viewer()
@Controller()
export class ReleaseNotesController {
  constructor(private readonly releaseNotes: ReleaseNotesService) {}

  /** Repos in scope, for whoever picks the one to summarise. */
  @Get('sources/:id/repos')
  repos(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    return this.releaseNotes.repos(id, abortOnDisconnect(res));
  }

  /** Tags of a repo, for whoever picks the range. */
  @Get('sources/:id/tags')
  tags(
    @Param('id') id: string,
    @Query() query: RepoQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.releaseNotes.tags(id, query.repo, abortOnDisconnect(res));
  }

  /** Branches of a repo — a range bound may be one. */
  @Get('sources/:id/branches')
  branches(
    @Param('id') id: string,
    @Query() query: RepoQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.releaseNotes.branches(id, query.repo, abortOnDisconnect(res));
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

  /**
   * Bound to no source: the notes travel in the body, so nothing here needs a
   * connector. Reserved to an account rather than left with the reads above —
   * this one spends the install's model budget, and a public dashboard would
   * otherwise open that to anyone.
   */
  @Account()
  @Post('release-notes/rewrite')
  rewrite(@Body() dto: RewriteReleaseNotesDto, @Res({ passthrough: true }) res: Response) {
    return this.releaseNotes.rewrite(dto, abortOnDisconnect(res));
  }
}
