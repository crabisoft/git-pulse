import { Module } from '@nestjs/common';
import { ApiBudgetService } from './api-budget.service';
import { ApiQuotaService } from './api-quota.service';
import { ApiQuotaController } from './api-quota.controller';

@Module({
  controllers: [ApiQuotaController],
  providers: [ApiQuotaService, ApiBudgetService],
  exports: [ApiQuotaService, ApiBudgetService],
})
export class ApiQuotaModule {}
