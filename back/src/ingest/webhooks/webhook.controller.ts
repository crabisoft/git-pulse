import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Anonymous } from '../../auth/access.decorator';
import { WebhookService } from './webhook.service';

/**
 * Where GitHub and GitLab deliver their events.
 *
 * Anonymous to the session layer, and only to it: GitHub holds no account here,
 * so there is nothing to sign in as. What authenticates a caller is the
 * signature over the body — see `signature.ts` — and a delivery that fails it
 * is refused before its payload is even parsed.
 */
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  /**
   * Answers 204 as soon as the delivery is authenticated and recorded, the work
   * itself going to the queue. A provider that is kept waiting marks the
   * delivery failed and eventually stops sending, so the response time here is
   * a feature and not an optimisation.
   */
  @Anonymous()
  @Post(':sourceId')
  @HttpCode(204)
  async receive(
    @Param('sourceId') sourceId: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<void> {
    // The bytes as sent: re-serializing the parsed body would not reproduce the
    // signature, whitespace and key order being the sender's to choose.
    await this.webhooks.accept(sourceId, req.headers, req.rawBody ?? Buffer.alloc(0));
  }
}
