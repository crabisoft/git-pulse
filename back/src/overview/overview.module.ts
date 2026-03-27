import { Module } from '@nestjs/common';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DoraModule } from '../dora/dora.module';
import { JobsModule } from '../jobs/jobs.module';
import { ApiQuotaModule } from '../api-quota/api-quota.module';

/**
 * Reads nothing of its own: it is the one place that puts the collected view,
 * the metrics, their movement and the health of the collection side by side,
 * so a landing page costs one round trip rather than five.
 *
 * No collection module any more: the trends used to be read back from the
 * historised snapshots, and they are now cut from the period being reported
 * on — which the DORA service already holds the events for.
 */
@Module({
  imports: [DashboardModule, DoraModule, JobsModule, ApiQuotaModule],
  controllers: [OverviewController],
  providers: [OverviewService],
  exports: [OverviewService],
})
export class OverviewModule {}
