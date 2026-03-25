import { Controller, Get } from '@nestjs/common';
import { CoverageService } from './coverage.service';

@Controller('coverage')
export class CoverageController {
  constructor(private readonly coverage: CoverageService) {}

  /**
   * How much history every source actually holds, in one call — the same shape
   * as the quotas next to it on the sources page, and for the same reason: an
   * install watches a handful of sources, and the page draws them all at once.
   *
   * Admin, like the quotas: it counts rows and reports how deep the store is
   * kept, which is operational detail about the install rather than about what
   * the teams deployed.
   */
  @Get()
  list() {
    return this.coverage.list();
  }
}
