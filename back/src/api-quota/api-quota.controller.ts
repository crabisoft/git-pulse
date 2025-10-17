import { Controller, Get } from '@nestjs/common';
import { ApiQuotaService } from './api-quota.service';

@Controller('quotas')
export class ApiQuotaController {
  constructor(private readonly quotas: ApiQuotaService) {}

  /**
   * Every known quota, in one call. Deliberately not paginated, unlike the
   * other lists: there are as many rows as declared connections times metered
   * buckets, and the sources page needs them all at once to draw its gauges.
   */
  @Get()
  findAll() {
    return this.quotas.list();
  }
}
