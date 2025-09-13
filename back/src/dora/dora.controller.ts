import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DoraService } from './dora.service';
import { toWindow } from '../common/pagination';
import { abortOnDisconnect } from '../common/request-abort';
import { SettingsService } from '../settings/settings.service';
import { DoraQueryDto, toDimensionFilter } from './dto/dora-query.dto';

@Controller()
export class DoraController {
  constructor(
    private readonly dora: DoraService,
    private readonly settings: SettingsService,
  ) {}

  /** DORA metrics for a source over the requested period, scope and slice. */
  @Get('sources/:id/dora')
  async compute(
    @Param('id') id: string,
    @Query() query: DoraQueryDto,
    // `passthrough` keeps Nest in charge of the response: the handler still
    // returns its payload, `res` is only watched for the disconnect.
    @Res({ passthrough: true }) res: Response,
  ) {
    // Every metric comes from the same fetched data set, so the page window is
    // applied to the computed results rather than pushed down to the connector.
    const pageSize = await this.settings.pageSize();
    return this.dora.report(
      id,
      {
        from: query.from,
        to: query.to,
        windowDays: query.windowDays,
        repos: query.repos,
        dimensions: toDimensionFilter(query.dimension),
      },
      toWindow(query, pageSize),
      abortOnDisconnect(res),
    );
  }
}
