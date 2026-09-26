/**
 * Chi porta avanti il ciclo di vita degli eventi su questa installazione.
 *
 * Due conduttori possibili, mai insieme:
 *
 *  - lo scaler dei bridge (GET /api/internal/jvb-desired-replicas, chiamato
 *    dal CronJob jvb-scaler nel profilo con scale-to-zero): scalda la sala
 *    prima dell'inizio, la mette in pausa quando si svuota, la chiude;
 *  - il giro a bridge fisso (GET /api/cron/lifecycle): apre la sala
 *    all'orario d'inizio e la chiude, senza accendere né spegnere nulla.
 *
 * Il giro a bridge fisso parte ogni minuto su ogni installazione e si fa da
 * parte quando lo scaler c'è. Il segnale è un battito che lo scaler scrive in
 * Redis a ogni giro riuscito: JVB_SCALER_ENABLED da solo non basta, perché
 * dice che i bridge si accendono e si spengono da soli, non che qualcuno
 * sposti gli eventi da uno stato all'altro (con KEDA, per esempio, nessuno lo
 * fa). La variabile resta il ripiego quando Redis manca o non risponde.
 */

import { getRedis, withDeadline } from '@/lib/redis';

/** Chiave del battito dello scaler. */
export const SCALER_HEARTBEAT_KEY = 'lifecycle:driver:scaler';

/**
 * Vita del battito, in secondi. Deve coprire due giri dello scaler più la
 * durata massima di uno (nel chart: ogni 2 minuti, activeDeadlineSeconds 240,
 * concurrencyPolicy Forbid), cioè 480 s: un giro saltato, lento o fallito non
 * passa la mano al giro a bridge fisso. Il prezzo è l'attesa, fino a dieci
 * minuti, prima che il giro a bridge fisso subentri a uno scaler tolto.
 */
export const SCALER_HEARTBEAT_TTL_SECONDS = 600;

/** Attesa massima di Redis: oltre, vale il ripiego. */
const REDIS_DEADLINE_MS = 1000;

/**
 * La sala d'attesa interroga il ciclo di vita ogni pochi secondi per ogni
 * scheda aperta: il risultato si tiene in memoria qualche secondo, come lo
 * snapshot dei bridge.
 */
const CACHE_TTL_MS = 5000;
let cache: { at: number; value: boolean } | null = null;

/** Scrive il battito dello scaler. Mai un errore: il giro è già fatto. */
export async function recordScalerHeartbeat(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await withDeadline<unknown>(
    redis.set(SCALER_HEARTBEAT_KEY, new Date().toISOString(), 'EX', SCALER_HEARTBEAT_TTL_SECONDS),
    REDIS_DEADLINE_MS,
    null,
  );
  cache = null;
}

/**
 * Vero se lo scaler sta conducendo il ciclo di vita: il suo battito c'è.
 * Senza Redis, o se Redis non risponde, decide JVB_SCALER_ENABLED.
 */
export async function scalerDriverActive(
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const nowMs = Date.now();
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.value;

  const fallback = env.JVB_SCALER_ENABLED === 'true';
  const redis = getRedis();
  let value: boolean;
  if (!redis) {
    value = fallback;
  } else {
    const present = await withDeadline<boolean | null>(
      redis.exists(SCALER_HEARTBEAT_KEY).then((n) => n > 0),
      REDIS_DEADLINE_MS,
      null,
    );
    value = present ?? fallback;
  }
  cache = { at: nowMs, value };
  return value;
}

/** Solo per i test: dimentica il risultato in memoria. */
export function __resetScalerDriverCache(): void {
  cache = null;
}
