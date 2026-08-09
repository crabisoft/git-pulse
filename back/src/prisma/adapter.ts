import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The driver every PrismaClient here is built on: since v7 the schema carries
 * no URL and the client opens nothing it was not handed.
 */
export function prismaAdapter(): PrismaPg {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — see .env.example.');
  }
  return new PrismaPg({ connectionString });
}
