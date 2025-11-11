import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { ApiBudgetService } from './api-budget.service';
import { ApiQuotaService } from './api-quota.service';
import { DeclareBudgetDto } from './dto/declare-budget.dto';

@Controller('quotas')
export class ApiQuotaController {
  constructor(
    private readonly quotas: ApiQuotaService,
    private readonly budgets: ApiBudgetService,
  ) {}

  /**
   * Every known quota, in one call. Deliberately not paginated, unlike the
   * other lists: there are as many rows as declared connections times metered
   * buckets, and the sources page needs them all at once to draw its gauges.
   */
  @Get()
  findAll() {
    return this.quotas.list();
  }

  /** The declared ceilings, alongside the readings above. */
  @Get('budgets')
  listBudgets() {
    return this.budgets.list();
  }

  /**
   * Declares what a source's instance allows, for the ones that meter nothing.
   * An idempotent PUT: a subject has one ceiling, and re-declaring it replaces
   * what was there.
   */
  @Put('sources/:id/budget')
  declare(@Param('id') id: string, @Body() dto: DeclareBudgetDto) {
    return this.budgets.declareForSource(id, dto);
  }

  /** Withdraws it — back to reading whatever the provider reports, if anything. */
  @Delete('sources/:id/budget')
  @HttpCode(204)
  async withdraw(@Param('id') id: string): Promise<void> {
    await this.budgets.forget({ kind: 'source', id });
  }
}
