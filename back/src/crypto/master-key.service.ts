import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const KEY_LENGTH = 32; // AES-256

/**
 * Holds the master key (KEK) used to encrypt/decrypt stored secrets.
 *
 * Resolution order:
 *   1. MASTER_KEY env var (base64, 32 bytes) — convenient for Kubernetes or an
 *      external secret manager.
 *   2. MASTER_KEY_FILE — generated on first boot with 0600 permissions if absent.
 *
 * Losing this key makes every stored secret unrecoverable.
 */
@Injectable()
export class MasterKeyService implements OnModuleInit {
  private readonly logger = new Logger(MasterKeyService.name);
  private key!: Buffer;
  /** Current key version, so secrets can be re-encrypted on rotation. */
  readonly version = 1;

  onModuleInit(): void {
    const fromEnv = process.env.MASTER_KEY?.trim();
    if (fromEnv) {
      const buf = Buffer.from(fromEnv, 'base64');
      if (buf.length !== KEY_LENGTH) {
        throw new Error(
          `MASTER_KEY invalide : ${buf.length} octets décodés, ${KEY_LENGTH} attendus (base64 de 32 octets).`,
        );
      }
      this.key = buf;
      this.logger.log('Master key chargée depuis la variable d\'environnement MASTER_KEY.');
      return;
    }

    const filePath = resolve(process.env.MASTER_KEY_FILE ?? './data/master.key');
    this.key = existsSync(filePath) ? this.load(filePath) : this.generate(filePath);
  }

  getKey(version = this.version): Buffer {
    if (version !== this.version) {
      throw new Error(`Version de master key inconnue : ${version}`);
    }
    return this.key;
  }

  private load(filePath: string): Buffer {
    const raw = readFileSync(filePath, 'utf8').trim();
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== KEY_LENGTH) {
      throw new Error(
        `Fichier master key corrompu (${filePath}) : ${buf.length} octets, ${KEY_LENGTH} attendus.`,
      );
    }
    this.logger.log(`Master key chargée depuis ${filePath}.`);
    return buf;
  }

  private generate(filePath: string): Buffer {
    const key = randomBytes(KEY_LENGTH);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, key.toString('base64'), { mode: 0o600 });
    // Enforce permissions even if umask interfered.
    chmodSync(filePath, 0o600);
    this.logger.warn(
      `Aucune master key trouvée : nouvelle clé générée dans ${filePath} (0600). ` +
        'SAUVEGARDEZ ce fichier — sa perte rend les secrets irrécupérables.',
    );
    return key;
  }
}
