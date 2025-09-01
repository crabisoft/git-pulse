import { Controller, Get, Param, Query } from '@nestjs/common';
import { DoraService } from './dora.service';
import { PaginationQueryDto, paginate, toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';

@Controller()
export class DoraController {
  constructor(
    private readonly dora: DoraService,
    private readonly settings: SettingsService,
  ) {}

  /** Live DORA metrics for a source over the lookback window. */
  @Get('sources/:id/dora')
  async compute(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    // Every metric comes from the same fetched data set, so the page window is
    // applied to the computed results rather than pushed down to the connector.
    const [results, pageSize] = await Promise.all([
      this.dora.compute(id),
      this.settings.pageSize(),
    ]);
    return paginate(results, toWindow(query, pageSize));
  }
}
