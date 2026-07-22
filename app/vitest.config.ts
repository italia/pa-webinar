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
      // Questi valori sono il PAVIMENTO misurato, arrotondato in basso: servono
      // a impedire che scenda, non a dire che va bene. Il divario e' voluto ed
      // e' visibile: `include` copre tutto `src/**`, quindi il report mostra
      // anche le 153 route API e i componenti che oggi non hanno un test.
      // Quando la copertura sale, questi numeri si alzano — mai il contrario.
      thresholds: {
        lines: 7,
        functions: 57,
        branches: 73,
        statements: 7,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
