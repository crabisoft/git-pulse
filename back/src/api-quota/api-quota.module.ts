import { Module } from '@nestjs/common';
import { ApiQuotaService } from './api-quota.service';
import { ApiQuotaController } from './api-quota.controller';

@Module({
  controllers: [ApiQuotaController],
  providers: [ApiQuotaService],
  exports: [ApiQuotaService],
})
export class ApiQuotaModule {}
