import { Module } from '@nestjs/common';
import { SourcesModule } from '../sources/sources.module';
import { ReaderFactory } from './reader.factory';
import { StoreService } from './store.service';

/**
 * Everything that fills the read model and reads it back.
 *
 * Deliberately unaware of the sources module beyond what a reader needs: the
 * dependency runs one way, so a source can enqueue ingestion work without this
 * module and that one importing each other.
 */
@Module({
  imports: [SourcesModule],
  providers: [StoreService, ReaderFactory],
  exports: [StoreService, ReaderFactory],
})
export class IngestModule {}
