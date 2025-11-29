import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api is proxied to the backend so the browser talks to a single
// origin (no CORS). Target is the back service in Docker, localhost otherwise.
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3001';

// inotify events do not cross a bind mount reliably (Docker Desktop, WSL2), so
// HMR needs polling there. Off by default: native dev keeps free fs events.
const usePolling = process.env.VITE_USE_POLLING === '1';

// Hostnames the dev server answers to, beyond localhost. Reaching it through a
// tunnel needs the tunnel's hostname here, which is what testing webhooks from
// GitHub takes: the delivery lands on `/api`, which is proxied below.
//
// Left empty by default rather than opened: the check is what stops a page on
// another origin from resolving a name at this dev server and reading what it
// answers. Tunnel hostnames rotate, so this is a variable and not a list in the
// repository.
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The shared package is built as CommonJS for the backend; the frontend
      // reads its source so runtime exports survive bundling.
      '@repo/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      '/api': { target: proxyTarget, changeOrigin: true },
    },
  },
});
