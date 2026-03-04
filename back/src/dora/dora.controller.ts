import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DoraService } from './dora.service';
import { abortOnDisconnect } from '../common/request-abort';
import { DoraQueryDto, toDimensionFilter } from './dto/dora-query.dto';
import { DoraSamplesDto } from './dto/dora-samples.dto';
import { toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { Viewer } from '../auth/access.decorator';

/** The public half of the application, when the setting says it is public. */
@Viewer()
@Controller()
export class DoraController {
  constructor(
    private readonly dora: DoraService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The events behind one metric, paginated — every one of them.
   *
   * The reading itself carries a handful for a page that shows a list without
   * paging through it; auditing a figure needs the rest, and asking for them
   * one page at a time is what keeps that from being everybody's payload.
   */
  @Get('sources/:id/dora/samples')
  async samples(
    @Param('id') id: string,
    @Query() query: DoraSamplesDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.dora.samples(
      id,
      {
        from: query.from,
        to: query.to,
        windowDays: query.windowDays,
        repos: query.repos,
        dimensions: toDimensionFilter(query.dimension),
      },
      query.metric,
      toWindow(query, await this.settings.pageSize()),
      abortOnDisconnect(res),
    );
  }

  /** DORA metrics for a source over the requested period, scope and slice. */
  @Get('sources/:id/dora')
  compute(
    @Param('id') id: string,
    @Query() query: DoraQueryDto,
    // `passthrough` keeps Nest in charge of the response: the handler still
    // returns its payload, `res` is only watched for the disconnect.
    @Res({ passthrough: true }) res: Response,
  ) {
    // One reading per metric: there is nothing to page through, and a window
    // would only ever be able to drop one of the eight.
    return this.dora.report(
      id,
      {
        from: query.from,
        to: query.to,
        windowDays: query.windowDays,
        repos: query.repos,
        dimensions: toDimensionFilter(query.dimension),
      },
      abortOnDisconnect(res),
    );
  }
}
