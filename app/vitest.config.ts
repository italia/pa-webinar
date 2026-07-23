import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    passWithNoTests: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/types/**', '**/*.d.ts'],
      // ── Cricchetto, non obiettivo ────────────────────────────────────
      //
      // Qui c'erano 70/70/60/70. Numeri sensati come aspirazione, ma senza
      // provider installato e senza script che li misurasse: un cancelletto
      // decorativo, che faceva sembrare presidiata una cosa che non lo era.
      // Misurata davvero, la copertura per riga era del 5,5%.
      //
      // Un PAVIMENTO con margine, non il valore esatto misurato.
      //
      // Pinnare la soglia al numero preciso (7,1 / 57,3 / 73,8) fa fallire OGNI
      // PR che aggiunge quattro funzioni non coperte — cioe' quasi tutte, per
      // motivi che non c'entrano con quella PR: e' erosione del cricchetto al
      // contrario. Qui c'e' qualche punto di margine: cattura un CALO vero (una
      // libreria testata cancellata, un intero modulo che perde i suoi test),
      // lascia passare il rumore. Quando la copertura sale in modo stabile,
      // questi numeri si alzano — mai il contrario.
      //
      // Misurato al 23 lug: lines 7,1 · functions 57,3 · branches 73,8.
      thresholds: {
        lines: 6,
        functions: 52,
        branches: 68,
        statements: 6,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
