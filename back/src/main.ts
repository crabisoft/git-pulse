import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, type LogLevel } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/**
 * Ceiling on a request body. Express defaults to 100 kB, which a webhook payload
 * routinely exceeds — a push over a large repository carries every commit. Kept
 * well under what the providers themselves cap deliveries at, so an oversized
 * body is refused here rather than parsed.
 */
const BODY_LIMIT = process.env.BODY_LIMIT ?? '5mb';

/**
 * How much the API says about what it is doing, quietest first.
 *
 * `LOG_LEVEL` names one of them and means "this and everything above it", which
 * is the spelling every other service in a stack uses. `debug` is what somebody
 * looking into a probe that reads nothing turns on — the version readings
 * narrate every address they try at that level — and it is off by default
 * because a hundred environments narrate a hundred times per cycle.
 *
 * An unreadable value falls back to the default rather than silencing the API:
 * a typo in an environment variable must not be the reason nobody saw the
 * errors.
 */
const LEVELS: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
const DEFAULT_LEVEL = LEVELS.indexOf('log');

function logLevels(): LogLevel[] {
  const wanted = process.env.LOG_LEVEL?.trim().toLowerCase() as LogLevel | undefined;
  const depth = wanted && LEVELS.includes(wanted) ? LEVELS.indexOf(wanted) : DEFAULT_LEVEL;
  return LEVELS.slice(0, depth + 1);
}

async function bootstrap() {
  // `rawBody` keeps the unparsed body alongside the parsed one. Webhook
  // signatures are computed over the bytes as sent, and re-serializing the
  // parsed JSON does not reproduce them.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    rawBody: true,
    logger: logLevels(),
  });
  app.useBodyParser('json', { limit: BODY_LIMIT });

  // Behind a reverse proxy the caller's address arrives in X-Forwarded-For, and
  // the sign-in throttle counts against it. Opt-in, because trusting that
  // header when nothing sets it lets a caller choose the address it is
  // throttled as. The value is Express's own: `1` for a single hop, a subnet…
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  app.enableCors({ origin: webOrigin, credentials: true });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  new Logger('Bootstrap').log(`API ready on http://localhost:${port}/api`);
}

bootstrap();
