import { Module } from '@nestjs/common';
import { VersionReadingStore } from './version-reading.store';
import { EnvRulesModule } from '../env-rules/env-rules.module';

/**
 * The readings table, on its own — the same split the archive makes, for the
 * same reason: the deployments module reads what was filed, and the service
 * that files it depends on the deployments module to know what to file.
 */
@Module({
  // The rules come with it: a reading is handed out already classified, so the
  // two pages that read this table cannot disagree about what an environment is.
  imports: [EnvRulesModule],
  providers: [VersionReadingStore],
  exports: [VersionReadingStore],
})
export class VersionReadingStoreModule {}
