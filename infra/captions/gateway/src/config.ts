/**
 * Configurazione del gateway, tutta da variabili d'ambiente.
 *
 * I default sono quelli misurati con il banco di prova (infra/captions/bench):
 * boost del glossario basso, pausa che chiude la frase sotto il secondo,
 * soglie di ritardo che lasciano margine alla latenza del chunk.
 */

export interface Config {
  port: number;
  /** Segreto condiviso con Jicofo, presentato dal bridge come header. Vuoto = nessun controllo. */
  authToken: string | null;
  /** WebSocket realtime del motore (sidecar sullo stesso pod). */
  engineUrl: string;
  /** Rotta HTTP del motore che risponde quando il modello è caricato. */
  engineHealthUrl: string;
  /** Rotta interna del portale che dà lingua e vocabolario di una stanza. */
  contextUrl: string | null;
  contextToken: string | null;
  defaultLanguage: string;
  /** Peso del vocabolario dell'evento: sopra 1 il motore scrive termini mai detti. */
  boost: number;
  /** Voci trascritte insieme al massimo: oltre, le meno recenti restano senza sottotitoli. */
  maxStreams: number;
  /** Senza pacchetti per questo tempo la frase si chiude (il bridge scarta il silenzio). */
  pauseGapMs: number;
  /** Buchi nel flusso RTP fino a questa durata si riempiono di silenzio. */
  fillGapMs: number;
  /** Una voce ferma da questo tempo libera la sessione del motore. */
  idleCloseMs: number;
  /** Oltre questa lunghezza il sottotitolo va a capo su un confine di frase. */
  maxCaptionChars: number;
  /** Intervallo minimo tra due aggiornamenti provvisori della stessa voce. */
  interimIntervalMs: number;
  /** Ritardo (p95) oltre il quale si riducono le voci trascritte. */
  degradeLagMs: number;
  /** Ritardo (p95) oltre il quale la trascrizione si sospende. */
  pauseLagMs: number;
  /** Prima sospensione; le successive raddoppiano fino a `maxPauseMs`. */
  pauseCooldownMs: number;
  maxPauseMs: number;
  /** Attesa massima del testo definitivo del motore dopo la fine di una frase. */
  finishTimeoutMs: number;
  /** Ogni quanto si rilegge il contesto della stanza (un sesto, con i sottotitoli spenti). */
  contextRefreshMs: number;
}

function num(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${key} non valido: ${raw}`);
  }
  return value;
}

function str(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key]?.trim();
  return raw ? raw : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const enginePort = num(env, 'CAPTIONS_ENGINE_PORT', 8090, 1);
  return {
    port: num(env, 'PORT', 8080, 1),
    authToken: str(env, 'CAPTIONS_AUTH_TOKEN'),
    engineUrl:
      str(env, 'CAPTIONS_ENGINE_URL') ??
      `ws://127.0.0.1:${enginePort}/v1/audio/transcriptions/realtime`,
    engineHealthUrl:
      str(env, 'CAPTIONS_ENGINE_HEALTH_URL') ?? `http://127.0.0.1:${enginePort}/v1/models`,
    contextUrl: str(env, 'CAPTIONS_CONTEXT_URL'),
    contextToken: str(env, 'CAPTIONS_CONTEXT_TOKEN'),
    defaultLanguage: str(env, 'CAPTIONS_LANGUAGE') ?? 'it-IT',
    boost: num(env, 'CAPTIONS_BOOST', 0.5),
    maxStreams: num(env, 'CAPTIONS_MAX_STREAMS', 4, 1),
    pauseGapMs: num(env, 'CAPTIONS_PAUSE_GAP_MS', 900, 100),
    fillGapMs: num(env, 'CAPTIONS_FILL_GAP_MS', 200),
    idleCloseMs: num(env, 'CAPTIONS_IDLE_CLOSE_MS', 30_000, 1000),
    maxCaptionChars: num(env, 'CAPTIONS_MAX_CHARS', 160, 40),
    interimIntervalMs: num(env, 'CAPTIONS_INTERIM_INTERVAL_MS', 250),
    degradeLagMs: num(env, 'CAPTIONS_DEGRADE_LAG_MS', 1500, 100),
    pauseLagMs: num(env, 'CAPTIONS_PAUSE_LAG_MS', 3000, 100),
    pauseCooldownMs: num(env, 'CAPTIONS_PAUSE_COOLDOWN_MS', 60_000, 1000),
    maxPauseMs: num(env, 'CAPTIONS_MAX_PAUSE_MS', 600_000, 1000),
    finishTimeoutMs: num(env, 'CAPTIONS_FINISH_TIMEOUT_MS', 3000, 100),
    contextRefreshMs: num(env, 'CAPTIONS_CONTEXT_REFRESH_MS', 30_000, 100),
  };
}
