import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { MasterKeyService } from './master-key.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const AUTH_TAG_LENGTH = 16;

/** Encryption output — persisted as-is, in the type a Bytes column now has. */
export interface EncryptedSecret {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
  keyVersion: number;
}

/**
 * Authenticated encryption of secrets (source tokens, LLM keys).
 * AES-256-GCM with a unique IV per secret and the auth tag stored separately.
 */
@Injectable()
export class CryptoService {
  constructor(private readonly masterKey: MasterKeyService) {}

  encrypt(plaintext: string): EncryptedSecret {
    const keyVersion = this.masterKey.version;
    const key = this.masterKey.getKey(keyVersion);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { ciphertext, iv, authTag, keyVersion };
  }

  decrypt(secret: EncryptedSecret): string {
    const key = this.masterKey.getKey(secret.keyVersion);
    const decipher = createDecipheriv(ALGORITHM, key, secret.iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(secret.authTag);
    return Buffer.concat([
      decipher.update(secret.ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
