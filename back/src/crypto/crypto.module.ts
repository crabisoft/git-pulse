import { Global, Module } from '@nestjs/common';
import { MasterKeyService } from './master-key.service';
import { CryptoService } from './crypto.service';
import { CredentialsService } from './credentials.service';

@Global()
@Module({
  providers: [MasterKeyService, CryptoService, CredentialsService],
  exports: [MasterKeyService, CryptoService, CredentialsService],
})
export class CryptoModule {}
