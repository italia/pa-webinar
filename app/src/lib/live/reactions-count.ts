/**
 * I contatori della barra delle reazioni della sala, per evento, condivisi da
 * tutte le istanze dell'app.
 *
 * Ogni clic arriva a un'istanza qualsiasi e la sala rilegge i conteggi ogni
 * pochi secondi da un'istanza qualsiasi: tenuti nella memoria di un processo,
 * ogni istanza conterebbe solo i clic passati da lei, e i numeri sullo schermo
 * salterebbero avanti e indietro a seconda di chi risponde. Stanno quindi in
 * un hash Redis, con un incremento atomico per clic e una scadenza che si
 * rinnova a ogni clic. Le righe `Reaction` della rotta restano quelle delle
 * statistiche: questi sono solo i numeri della diretta.
 *
 * Senza Redis (lo stack locale), o con Redis che non risponde, vale la memoria
 * del processo, come una replica sola; la memoria segue Redis a ogni lettura
 * riuscita, cosi' un momento in cui Redis non risponde non riporta i numeri a
 * zero. Quando Redis torna valgono di nuovo i suoi numeri: i clic contati solo
 * qui nel frattempo si perdono, e un Redis riavviato (non conserva nulla)
 * riparte da zero.
 */

import { getCached, setCache } from '@/lib/cache';
import { liveRedisReady } from '@/lib/live-state/pubsub';
import { getRedis, withDeadline } from '@/lib/redis';
import { VALID_EMOJIS } from '@/lib/validation/schemas';

export type ReactionCounts = Record<string, number>;

/** Quanto restano i conteggi dopo l'ultimo clic. */
export const REACTIONS_TTL_MS = 4 * 60 * 60 * 1000;

const REDIS_TIMEOUT_MS = 1000;

/** Chiave della memoria del processo: la stessa di prima di Redis. */
const chiaveLocale = (eventId: string) => `reactions:${eventId}`;
const chiaveRedis = (eventId: string) => `live:reactions:${eventId}`;

/** Tutte le emoji della barra, a zero. */
function aZero(): ReactionCounts {
  const counts: ReactionCounts = {};
  for (const e of VALID_EMOJIS) counts[e] = 0;
  return counts;
}

/** Copia nella memoria del processo, con tutte le emoji presenti. */
function ricorda(eventId: string, counts: ReactionCounts): void {
  setCache(chiaveLocale(eventId), counts, REACTIONS_TTL_MS);
}

function memoria(eventId: string): ReactionCounts {
  return { ...aZero(), ...(getCached<ReactionCounts>(chiaveLocale(eventId)) ?? {}) };
}

/** Conta un clic e restituisce il nuovo totale di quell'emoji. */
export async function contaReazione(eventId: string, emoji: string): Promise<number> {
  const redis = getRedis();
  if (redis && (await liveRedisReady(REDIS_TIMEOUT_MS))) {
    const esito = await withDeadline(
      redis
        .multi()
        .hincrby(chiaveRedis(eventId), emoji, 1)
        .pexpire(chiaveRedis(eventId), REACTIONS_TTL_MS)
        .exec(),
      REDIS_TIMEOUT_MS,
      null
    );
    const [errore, valore] = esito?.[0] ?? [new Error('mancante'), null];
    const totale = errore ? Number.NaN : Number(valore);
    if (Number.isFinite(totale)) {
      const counts = memoria(eventId);
      counts[emoji] = totale;
      ricorda(eventId, counts);
      return totale;
    }
    // Redis non ha risposto: il clic si conta almeno qui.
  }
  const counts = memoria(eventId);
  counts[emoji] = (counts[emoji] || 0) + 1;
  ricorda(eventId, counts);
  return counts[emoji];
}

/** I conteggi dell'evento, con tutte le emoji della barra (a zero se mai cliccate). */
export async function leggiReazioni(eventId: string): Promise<ReactionCounts> {
  const redis = getRedis();
  if (redis && (await liveRedisReady(REDIS_TIMEOUT_MS))) {
    const tutti = await withDeadline<Record<string, string> | null>(
      redis.hgetall(chiaveRedis(eventId)),
      REDIS_TIMEOUT_MS,
      null
    );
    // Un hash che non c'e' torna come `{}`: `null` e' solo la lettura mancata.
    if (tutti) {
      const counts = aZero();
      for (const [emoji, raw] of Object.entries(tutti)) {
        const n = Number(raw);
        if (Number.isFinite(n)) counts[emoji] = n;
      }
      ricorda(eventId, counts);
      return { ...counts };
    }
  }
  return memoria(eventId);
}
