import { Module } from '@nestjs/common';
import { EnvUrlsService } from './env-urls.service';
import { EnvUrlsController } from './env-urls.controller';

@Module({
  controllers: [EnvUrlsController],
  providers: [EnvUrlsService],
  exports: [EnvUrlsService],
})
export class EnvUrlsModule {}
