import { existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// design-react-kit dichiara nelle `exports` solo le condizioni `module` e
// `main`, che Vite non riconosce, e il suo ESM importa file senza estensione,
// che Node non carica. I test di componente usano il pacchetto CommonJS dello
// stesso kit: gli stessi componenti che vede l'app.
const designReactKit = createRequire(import.meta.url)
  .resolve.paths('design-react-kit')
  ?.map((dir) => path.join(dir, 'design-react-kit', 'dist', 'index.cjs'))
  .find((file) => existsSync(file));

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
      // Un PAVIMENTO con margine STRETTO, non il valore esatto misurato.
      //
      // Due estremi da evitare, entrambi visti in review: pinnare al numero
      // preciso fa fallire ogni PR che aggiunge quattro funzioni non coperte
      // (rumore, non regressione); scendere di cinque punti rinuncia al
      // cricchetto (la perdita di un intero modulo passa). Il margine giusto e'
      // di un paio di punti: assorbe il rumore di una PR normale, ma la
      // cancellazione di una libreria testata — che vale parecchi punti — lo
      // sfonda e fa rosso. Quando la copertura sale in modo stabile, questi
      // numeri si alzano dietro; mai il contrario.
      //
      // Misurato al 23 lug: lines 7,1 · functions 57,3 · branches 73,8.
      thresholds: {
        lines: 6,
        functions: 55,
        branches: 71,
        statements: 6,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      ...(designReactKit ? { 'design-react-kit': designReactKit } : {}),
    },
  },
});
