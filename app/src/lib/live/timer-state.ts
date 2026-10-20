/**
 * Lo stato del timer degli interventi, uno per evento, condiviso da tutte le
 * istanze dell'app.
 *
 * Il moderatore lo comanda con una richiesta che arriva a un'istanza qualsiasi,
 * e la sala lo rilegge ogni pochi secondi da un'istanza qualsiasi: tenuto nella
 * memoria di un processo, chi rilegge da un'altra istanza vedrebbe un timer
 * spento, o un timer che compare e sparisce a seconda di chi risponde. Sta
 * quindi in Redis, con scadenza: non e' un dato da conservare, e nessuna
 * tabella lo tiene.
 *
 * Senza Redis (lo stack locale), o con Redis che non risponde, vale la memoria
 * del processo, come una replica sola. La memoria segue Redis a ogni lettura e
 * scrittura riuscita: se Redis non risponde per un momento, questa istanza
 * continua a rispondere con l'ultimo stato che conosceva invece che con un
 * timer spento. Quando Redis torna vale di nuovo Redis: un comando dato mentre
 * non rispondeva resta su un'istanza sola, e un Redis riavviato (non conserva
 * nulla) riparte senza timer. In entrambi i casi il moderatore lo riavvia.
 *
 * Due moderatori che premono nello stesso istante su istanze diverse: vince
 * l'ultima scrittura, come con un pulsante premuto due volte. Lo stesso vale
 * per una scrittura che Redis accetta solo dopo la scadenza dell'attesa: il
 * client la tiene in coda e la consegna quando Redis risponde di nuovo.
 */

import { deleteCache, getCached, setCache } from '@/lib/cache';
import { liveRedisReady } from '@/lib/live-state/pubsub';
import { getRedis, withDeadline } from '@/lib/redis';

export interface TimerState {
  active: boolean;
  /** Durata impostata, in secondi. */
  duration: number;
  /** Secondi rimasti al momento di `startedAt` (o della pausa). */
  remaining: number;
  visible: boolean;
  startedAt: number | null;
  pausedAt: number | null;
}

/**
 * Quanto resta lo stato dopo l'ultimo comando. Ben oltre la durata massima
 * (due ore, lib/validation/schemas): un timer lungo arriva a «Tempo scaduto»,
 * e uno in pausa durante una pausa lunga resta dov'era.
 */
export const TIMER_TTL_MS = 12 * 60 * 60 * 1000;

/** Attesa massima di Redis, compresa una connessione che si sta aprendo. */
const REDIS_TIMEOUT_MS = 1000;

/** Chiave della memoria del processo: la stessa di prima di Redis. */
const chiaveLocale = (eventId: string) => `timer:${eventId}`;
const chiaveRedis = (eventId: string) => `live:timer:${eventId}`;

/** Redis non ha risposto: non e' «nessun timer». */
const NON_RISPOSTO = Symbol('non risposto');

function numeroONull(v: unknown): number | null | undefined {
  if (v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Lo stato letto da Redis, o `null` se manca o non e' leggibile. */
function leggiStato(raw: string | null): TimerState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const startedAt = numeroONull(v.startedAt);
    const pausedAt = numeroONull(v.pausedAt);
    if (
      typeof v.active !== 'boolean' ||
      typeof v.visible !== 'boolean' ||
      typeof v.duration !== 'number' ||
      typeof v.remaining !== 'number' ||
      startedAt === undefined ||
      pausedAt === undefined
    ) {
      return null;
    }
    return {
      active: v.active,
      duration: v.duration,
      remaining: v.remaining,
      visible: v.visible,
      startedAt,
      pausedAt,
    };
  } catch {
    return null;
  }
}

/** Il timer dell'evento, o `null` se nessuno l'ha mai impostato (o e' scaduto). */
export async function leggiTimer(eventId: string): Promise<TimerState | null> {
  const inMemoria = getCached<TimerState>(chiaveLocale(eventId));
  // Una copia: chi legge puo' modificarla senza toccare la memoria.
  const locale = inMemoria ? { ...inMemoria } : null;
  const redis = getRedis();
  if (!redis || !(await liveRedisReady(REDIS_TIMEOUT_MS))) return locale;

  const raw = await withDeadline<string | null | typeof NON_RISPOSTO>(
    redis.get(chiaveRedis(eventId)),
    REDIS_TIMEOUT_MS,
    NON_RISPOSTO
  );
  if (raw === NON_RISPOSTO) return locale;

  const stato = leggiStato(raw);
  if (stato) setCache(chiaveLocale(eventId), { ...stato }, TIMER_TTL_MS);
  else deleteCache(chiaveLocale(eventId));
  return stato;
}

/**
 * Salva il timer dell'evento per tutte le istanze. La memoria del processo si
 * aggiorna comunque: se Redis non risponde, almeno questa istanza resta
 * coerente con il comando appena dato.
 */
export async function scriviTimer(eventId: string, stato: TimerState): Promise<void> {
  setCache(chiaveLocale(eventId), { ...stato }, TIMER_TTL_MS);
  const redis = getRedis();
  if (!redis || !(await liveRedisReady(REDIS_TIMEOUT_MS))) return;
  await withDeadline<unknown>(
    redis.set(chiaveRedis(eventId), JSON.stringify(stato), 'PX', TIMER_TTL_MS),
    REDIS_TIMEOUT_MS,
    null
  );
}
