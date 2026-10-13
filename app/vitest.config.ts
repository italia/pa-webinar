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
      // Un PAVIMENTO con margine STRETTO, non il valore esatto misurato.
      //
      // Pinnare al numero preciso fa fallire ogni PR che aggiunge quattro
      // funzioni non coperte (rumore, non regressione); scendere di cinque
      // punti rinuncia al cricchetto (la perdita di un intero modulo passa).
      // Il margine giusto e' di un paio di punti: assorbe il rumore di una PR
      // normale, ma la cancellazione di una libreria testata — che vale
      // parecchi punti — lo sfonda e fa rosso. Quando la copertura sale in
      // modo stabile, questi numeri si alzano dietro; mai il contrario.
      //
      // Misura di riferimento (Vitest 5, copertura V8 rimappata sull'AST):
      // lines 46,0 · functions 40,3 · branches 41,8 · statements 45,0.
      thresholds: {
        lines: 44,
        functions: 38,
        branches: 40,
        statements: 43,
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
