import { Module } from '@nestjs/common';
import { ChangelogStore } from './changelog.store';

/**
 * The archive's table, on its own.
 *
 * A module of one provider because two others need it and they are not
 * interchangeable: the deployments module reads it to answer with what was
 * filed, and the archiver above it writes it — while itself depending on the
 * deployments module to know what to file. Splitting the table out is what
 * keeps that dependency running one way.
 */
@Module({
  providers: [ChangelogStore],
  exports: [ChangelogStore],
})
export class ChangelogStoreModule {}
