import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { SourceKind } from '@repo/shared';
import { CodedException } from '../../common/coded-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../crypto/crypto.service';
import { toGitHubIntent, toGitLabIntent, type IngestIntent } from './events';
import { verify, type HeaderBag } from './signature';

/** What became of a delivery. Returned for the logs, never to the caller. */
export type DeliveryOutcome = 'accepted' | 'duplicate' | 'ignored';

/**
 * Receives the events a provider pushes.
 *
 * Three things happen here and nothing else: authenticate, recognise a repeat,
 * hand the work to the queue. The response has to be quick — a provider that
 * waits marks the delivery failed and, after enough of them, disables the hook —
 * so nothing that talks to a provider or writes a row belongs on this path.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @InjectQueue('ingest') private readonly queue: Queue,
  ) {}

  async accept(sourceId: string, headers: HeaderBag, body: Buffer): Promise<DeliveryOutcome> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { kind: true, mode: true, webhooksEnabled: true, webhookSecret: true },
    });

    // One answer for "no such source", "not listening" and "no secret issued":
    // telling them apart would let a caller enumerate the sources of an install
    // it has no account on.
    if (!source || !source.webhooksEnabled || source.mode !== 'stored' || !source.webhookSecret) {
      throw new CodedException('errors.webhook.unknown', HttpStatus.NOT_FOUND);
    }

    const secret = this.crypto.decrypt({
      ciphertext: source.webhookSecret.ciphertext,
      iv: source.webhookSecret.iv,
      authTag: source.webhookSecret.authTag,
      keyVersion: source.webhookSecret.keyVersion,
    });

    const verdict = verify(source.kind as SourceKind, headers, body, secret);
    if (!verdict.ok) {
      this.logger.warn(`Livraison refusée pour ${sourceId} : ${verdict.reason}.`);
      throw new CodedException('errors.webhook.rejected', HttpStatus.UNAUTHORIZED);
    }

    // Recorded before the work is queued, and the unique index is what makes
    // this safe across several API instances: whoever loses the insert knows
    // somebody else is already handling it.
    const first = await this.remember(sourceId, verdict.deliveryId, verdict.event);
    if (!first) return 'duplicate';

    const intent = this.toIntent(source.kind as SourceKind, verdict.event, body);
    // Most events say nothing this store holds. Having recorded the delivery is
    // still right: replaying it would not say any more.
    if (!intent) return 'ignored';

    await this.queue.add(
      'ingest-event',
      { sourceId, intent },
      { removeOnComplete: true, removeOnFail: 100 },
    );
    return 'accepted';
  }

  /** True when this delivery had not been seen before. */
  private async remember(sourceId: string, deliveryId: string, event: string): Promise<boolean> {
    try {
      await this.prisma.webhookDelivery.create({ data: { sourceId, deliveryId, event } });
      return true;
    } catch (e) {
      if (isUniqueViolation(e)) return false;
      throw e;
    }
  }

  /**
   * Parses the body only once it is known to be authentic. Malformed JSON from
   * a caller that knows the secret is a provider bug, not an attack, so it is
   * logged and dropped rather than retried.
   */
  private toIntent(kind: SourceKind, event: string, body: Buffer): IngestIntent | null {
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      this.logger.warn(`Charge utile illisible sur l'événement ${event}.`);
      return null;
    }
    return kind === 'github' ? toGitHubIntent(event, payload) : toGitLabIntent(event, payload);
  }
}

/** Prisma's code for a unique constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
