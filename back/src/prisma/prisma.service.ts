import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { prismaAdapter } from './adapter';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: prismaAdapter() });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // $connect only readies the pool now that the driver opens the connections.
    // Without a query behind it, an API pointed at a dead database boots fine
    // and fails one request at a time instead of refusing to start.
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
