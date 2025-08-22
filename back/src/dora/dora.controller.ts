import { Controller, Get, Param } from '@nestjs/common';
import { DoraService } from './dora.service';

@Controller()
export class DoraController {
  constructor(private readonly dora: DoraService) {}

  /** Live DORA metrics for a source over the lookback window. */
  @Get('sources/:id/dora')
  compute(@Param('id') id: string) {
    return this.dora.compute(id);
  }
}
