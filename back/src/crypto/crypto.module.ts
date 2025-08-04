import { Global, Module } from '@nestjs/common';
import { MasterKeyService } from './master-key.service';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [MasterKeyService, CryptoService],
  exports: [MasterKeyService, CryptoService],
})
export class CryptoModule {}
