import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * The dev server as the three screenshot and layout suites run it.
 *
 * Identical to the real one but for where it caches. `node_modules/.vite` is
 * whatever the dev stack left there, which on a bind mount is root-owned, and a
 * server that cannot write its cache does not start — so the cache goes
 * somewhere every user can write, outside the working tree either way.
 *
 * Kept out of `vite.config.ts` so nothing about the real dev experience depends
 * on a workaround for how the suites happen to be run.
 */
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: process.env.VITE_SCREENS_CACHE_DIR ?? '/tmp/git-pulse-vite-screens',
  }),
);
