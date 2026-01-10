import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { UserPublic } from '@repo/shared';
import { OverviewService } from './overview.service';
import { OverviewQueryDto } from './dto/overview-query.dto';
import { abortOnDisconnect } from '../common/request-abort';
import { CurrentUser, Viewer } from '../auth/access.decorator';

/** The public half of the application, when the setting says it is public. */
@Viewer()
@Controller('overview')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  /** Everything the landing page reads, for one source, in one call. */
  @Get(':sourceId')
  report(
    @Param('sourceId') sourceId: string,
    @Query() query: OverviewQueryDto,
    @CurrentUser() user: UserPublic | null,
    // `passthrough` keeps Nest in charge of the response: the handler still
    // returns its payload, `res` is only watched for the disconnect.
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.overview.report(sourceId, query, user !== null, abortOnDisconnect(res));
  }
}
