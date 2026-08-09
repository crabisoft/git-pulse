import { defineConfig } from 'prisma/config';

// v7 reads no .env of its own. Path relative to `back/`, the working directory
// every prisma npm script runs from; absent in a container, where the URL is
// already exported.
try {
  process.loadEnvFile('../.env');
} catch {
  // No root .env: the environment carries the URL, or nothing does.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Not prisma's `env()`: that throws while the config loads, taking down
  // `prisma generate` too — which the image build runs with no database.
  datasource: {
    url: process.env.DATABASE_URL,
    // What `migrate diff --from-migrations` replays into. v7 dropped the flag,
    // so this is the only place left to name it.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
