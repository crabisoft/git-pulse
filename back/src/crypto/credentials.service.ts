import { Injectable } from '@nestjs/common';
import type { Credential, CredentialOwner, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from './crypto.service';

/** Who a stored secret belongs to. */
export interface CredentialRef {
  type: CredentialOwner;
  id: string;
}

/**
 * Stored secrets, whoever holds them. Callers hand over a plaintext and get one
 * back; the envelope — encryption, key version, the row itself — stays here.
 *
 * The owner is a pair rather than a relation, so nothing cascades: forgetting a
 * secret is part of deleting its owner, not an afterthought.
 */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * The write as an operation, for a caller that has other rows to write with
   * it. Creating an owner and its secret has to be one thing: a source whose
   * credential write failed authenticates nothing, and one whose auth scheme
   * changed without its secret authenticates wrongly.
   */
  writeOp(owner: CredentialRef, plaintext: string): Prisma.PrismaPromise<Credential> {
    const enc = this.crypto.encrypt(plaintext);
    const stored = {
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      keyVersion: enc.keyVersion,
    };
    return this.prisma.credential.upsert({
      where: { ownerType_ownerId: { ownerType: owner.type, ownerId: owner.id } },
      create: { ownerType: owner.type, ownerId: owner.id, ...stored },
      update: stored,
    });
  }

  /** Writes the secret, replacing whatever that owner had. */
  async set(owner: CredentialRef, plaintext: string): Promise<void> {
    await this.writeOp(owner, plaintext);
  }

  /** The decrypted secret, or null when that owner has none. */
  async read(owner: CredentialRef): Promise<string | null> {
    const row = await this.prisma.credential.findUnique({
      where: { ownerType_ownerId: { ownerType: owner.type, ownerId: owner.id } },
    });
    return row ? this.crypto.decrypt(row) : null;
  }

  /** Which of these owners hold a secret — asked to render a form, never to use one. */
  async heldBy(type: CredentialOwner, ids: string[]): Promise<Set<string>> {
    const rows = await this.prisma.credential.findMany({
      where: { ownerType: type, ownerId: { in: ids } },
      select: { ownerId: true },
    });
    return new Set(rows.map((r) => r.ownerId));
  }

  /**
   * Drops the secret. No cascade reaches a polymorphic key, so this is what
   * keeps a deleted owner's secret from outliving it.
   */
  async forget(owner: CredentialRef): Promise<void> {
    await this.prisma.credential.deleteMany({
      where: { ownerType: owner.type, ownerId: owner.id },
    });
  }
}
