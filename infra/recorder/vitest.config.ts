import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Logica pura (paths/manifest/upload): nessun DOM, ambiente node.
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      // capture.ts richiede un Jitsi reale → fuori dal coverage unitario.
      exclude: ['src/**/*.test.ts', 'src/capture.ts', 'src/index.ts'],
    },
  },
});
