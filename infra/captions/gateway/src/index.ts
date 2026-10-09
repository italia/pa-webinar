/**
 * Punto d'ingresso del gateway dei sottotitoli live.
 *
 * Nessun testo trascritto e nessun nome finisce nei log: solo eventi di
 * servizio (conferenze collegate, stato del carico, motore raggiungibile).
 */

import { loadConfig } from './config.js';
import { ContextProvider } from './context.js';
import { Gateway } from './gateway.js';
import { createGatewayServer } from './server.js';

const config = loadConfig();
if (!config.authToken) {
  console.warn('[captions] CAPTIONS_AUTH_TOKEN vuoto: il gateway accetta connessioni senza segreto');
}

const gateway = new Gateway(
  config,
  new ContextProvider({
    url: config.contextUrl,
    token: config.contextToken,
    defaultLanguage: config.defaultLanguage,
  }),
);
gateway.start();

const server = createGatewayServer(gateway);
server.listen(config.port, () => {
  console.log(
    `[captions] in ascolto su :${config.port} · fino a ${config.maxStreams} voci · lingua ${config.defaultLanguage}`,
  );
});

function shutdown(signal: string): void {
  console.log(`[captions] ${signal}: chiusura`);
  gateway.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
