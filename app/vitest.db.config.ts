import path from 'path';

import { defineConfig } from 'vitest/config';

// Le prove su un PostgreSQL vero, a parte da `vitest.config.ts`: la suite
// normale non ha bisogno di servizi. Coprono quello che un client simulato non
// puo' dire: vincoli, cascate, transazioni, gare fra richieste, colonne uuid.
//
// Svuotano il database a ogni prova, quindi `TEST_DATABASE_URL` e' una variabile
// a se' e non `DATABASE_URL`, e `global-setup.ts` rifiuta un database che non
// finisce in `_test`.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/test/db/**/*.db.test.ts'],
    globalSetup: ['./src/test/db/global-setup.ts'],
    setupFiles: ['./src/test/db/setup.ts'],
    // Un database solo per tutti i file: uno alla volta.
    fileParallelism: false,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: '',
      APP_SECRET: 'segreto-delle-prove-sul-database-abbastanza-lungo-per-hs256',
      PII_ENCRYPTION_KEY:
        'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
      CRON_API_KEY: 'chiave-delle-prove-sul-database',
      JITSI_JWT_SECRET: 'segreto-jitsi-delle-prove-sul-database',
      JITSI_JWT_APP_ID: 'pa_webinar',
      JITSI_JWT_ISSUER: 'pa-webinar',
      JITSI_JWT_AUDIENCE: 'jitsi',
      JITSI_JWT_SUBJECT: 'localhost:8443',
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
