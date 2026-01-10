import { Module } from '@nestjs/common';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DoraModule } from '../dora/dora.module';
import { CollectionModule } from '../collection/collection.module';
import { JobsModule } from '../jobs/jobs.module';
import { ApiQuotaModule } from '../api-quota/api-quota.module';

/**
 * Reads nothing of its own: it is the one place that puts the collected view,
 * the metrics, their history and the health of the collection side by side, so
 * a landing page costs one round trip rather than five.
 */
@Module({
  imports: [DashboardModule, DoraModule, CollectionModule, JobsModule, ApiQuotaModule],
  controllers: [OverviewController],
  providers: [OverviewService],
  exports: [OverviewService],
})
export class OverviewModule {}
