import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suites cover the pure engines — classification, DORA maths, ticket
    // extraction — which take plain values and return plain values. No DOM, no
    // database, no Nest container to boot.
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
