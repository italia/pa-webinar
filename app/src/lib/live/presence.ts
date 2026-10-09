/**
 * Quante persone sono in diretta e quante in sala d'attesa, per evento.
 *
 * Ogni pagina aperta sulla sala manda un identificativo casuale (generato
 * nel browser, nessun dato personale) e dice dove si trova: ogni 15 secondi
 * in sala d'attesa, ogni 30 in diretta.
 * Redis tiene un insieme ordinato per luogo, con l'ora dell'ultimo segnale:
 * chi tace da più di FINESTRA_MS non conta più. Niente va su Postgres, e le
 * chiavi spariscono da sole quando nessuno segnala più.
 */

import { getRedis, withDeadline } from '@/lib/redis';

export type Luogo = 'attesa' | 'diretta';

export interface Presenze {
  inDiretta: number;
  inAttesa: number;
}

/** Più di due segnali persi in diretta (cinque in attesa) e non si conta più. */
export const FINESTRA_MS = 75_000;
/** Le chiavi scadono se nessuno segnala per dieci minuti. */
const SCADENZA_CHIAVE_S = 600;
const REDIS_TIMEOUT_MS = 500;

const chiave = (eventId: string, luogo: Luogo) => `presenza:${eventId}:${luogo}`;

/**
 * Segna chi c'è e dove, togliendolo dall'altro luogo (si passa dalla sala
 * d'attesa alla diretta e viceversa), e restituisce i conteggi aggiornati.
 * `null` = non si sa (Redis assente o lento): non è «nessuno».
 */
export async function segnaPresenza(
  eventId: string,
  id: string,
  luogo: Luogo,
  ora = Date.now(),
): Promise<Presenze | null> {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return null;
  const altro: Luogo = luogo === 'attesa' ? 'diretta' : 'attesa';
  const limite = ora - FINESTRA_MS;
  const risultati = await withDeadline(
    redis
      .pipeline()
      .zadd(chiave(eventId, luogo), ora, id)
      .zrem(chiave(eventId, altro), id)
      .zremrangebyscore(chiave(eventId, 'diretta'), 0, limite)
      .zremrangebyscore(chiave(eventId, 'attesa'), 0, limite)
      .zcard(chiave(eventId, 'diretta'))
      .zcard(chiave(eventId, 'attesa'))
      .expire(chiave(eventId, 'diretta'), SCADENZA_CHIAVE_S)
      .expire(chiave(eventId, 'attesa'), SCADENZA_CHIAVE_S)
      .exec(),
    REDIS_TIMEOUT_MS,
    null,
  );
  if (!risultati) return null;
  const numero = (i: number): number | null => {
    const [errore, valore] = risultati[i] ?? [new Error('mancante'), null];
    return errore ? null : Number(valore);
  };
  const inDiretta = numero(4);
  const inAttesa = numero(5);
  if (inDiretta === null || inAttesa === null || Number.isNaN(inDiretta) || Number.isNaN(inAttesa)) {
    return null;
  }
  return { inDiretta, inAttesa };
}

/** Chi chiude la pagina smette subito di contare. */
export async function lasciaPresenza(eventId: string, id: string): Promise<void> {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return;
  await withDeadline(
    redis.pipeline().zrem(chiave(eventId, 'diretta'), id).zrem(chiave(eventId, 'attesa'), id).exec(),
    REDIS_TIMEOUT_MS,
    null,
  );
}
