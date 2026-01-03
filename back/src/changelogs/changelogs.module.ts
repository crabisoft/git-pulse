import { Module } from '@nestjs/common';
import { ChangelogsController } from './changelogs.controller';
import { ChangelogsService } from './changelogs.service';
import { ChangelogStoreModule } from './changelog-store.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { SettingsModule } from '../settings/settings.module';
import { ApiQuotaModule } from '../api-quota/api-quota.module';

/**
 * The archive: what fills it, and what reads it back.
 *
 * It borrows the deployments module rather than listing deployments itself —
 * what a deployment carried has to be the same answer the deployments page
 * gives, or the history would slowly stop describing the present.
 */
@Module({
  imports: [ChangelogStoreModule, DeploymentsModule, SettingsModule, ApiQuotaModule],
  controllers: [ChangelogsController],
  providers: [ChangelogsService],
  exports: [ChangelogsService],
})
export class ChangelogsModule {}
