/** Parses REDIS_URL into a BullMQ/ioredis connection. */
export function redisConnection(): { host: string; port: number } {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return { host: url.hostname, port: Number(url.port || 6379) };
}
