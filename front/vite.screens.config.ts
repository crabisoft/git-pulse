import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * The dev server as the screenshot suite runs it.
 *
 * Identical to the real one but for where it caches: `node_modules/.vite` is
 * root-owned in this container, and a server that cannot write its cache cannot
 * start. Kept out of `vite.config.ts` so nothing about the real dev experience
 * depends on a workaround for one machine.
 */
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: '/tmp/claude-1000/-workspace/20aa4663-64fb-4a25-9b52-fef2222b57e1/scratchpad/vite-cache',
  }),
);
