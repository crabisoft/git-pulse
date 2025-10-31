import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

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
  new Logger('Bootstrap').log(`API prête sur http://localhost:${port}/api`);
}

bootstrap();
