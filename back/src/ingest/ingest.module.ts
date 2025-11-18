import { Module } from '@nestjs/common';
import { StoreService } from './store.service';

/**
 * Everything that fills the read model and reads it back.
 *
 * Nothing reads from it yet: the dashboard still calls its provider on every
 * request. Filling the store first, and switching the read path after, keeps
 * the change that cannot break anything apart from the one that can.
 */
@Module({
  providers: [StoreService],
  exports: [StoreService],
})
export class IngestModule {}
