/**
 * Chi c'e' dietro ogni riquadro della chiamata, per chi modera.
 *
 * Jitsi non dice a quale iscrizione corrisponde un partecipante: l'endpoint id
 * lo sceglie la conferenza e il nome lo scrive chi entra. Ogni browser, appena
 * entrato nella chiamata, dichiara il proprio endpoint presentando il token
 * della sala, e il server lo lega a cio' che quel token prova: l'iscrizione
 * (dal browser che si e' iscritto), un link d'iscrizione aperto altrove, una
 * concessione nominale, il link condiviso dei moderatori. Chi modera legge
 * nome ed email dell'iscrizione accanto al nome mostrato in sala, e riconosce
 * chi e' entrato con un nome diverso.
 *
 * Si conservano solo riferimenti (l'id dell'iscrizione o della concessione),
 * mai nomi o email, in Redis con scadenza; senza Redis nella memoria del
 * processo. Il server non puo' sapere quale browser possiede un endpoint: lo
 * dichiara il browser stesso, e gli altri ne vedono l'id appena entra. Se due
 * posti diversi dichiarano lo stesso endpoint, l'endpoint diventa conteso e
 * resta tale: chi modera legge «non verificabile» invece di un'identita' che
 * potrebbe essere quella sbagliata.
 */

import { getRedis, withDeadline } from '@/lib/redis';

export type Seat =
  /** L'iscritto, dal browser che si e' iscritto. */
  | { k: 'reg'; id: string }
  /** Il link di un'iscrizione, aperto da un altro browser. */
  | { k: 'fwd'; id: string }
  /** Una concessione nominale (moderatore o relatore). */
  | { k: 'grant'; id: string }
  /** Il link condiviso dei moderatori: nessuna persona dietro. */
  | { k: 'primary' }
  /** Dichiarato da due posti diversi: non si sa chi c'e'. */
  | { k: 'conflict' };

/** Quanto resta un endpoint dopo l'ultima dichiarazione nell'evento. */
const SEATS_TTL_SECONDS = 12 * 60 * 60;
/** Tetto per evento nella memoria del processo (senza Redis). */
const MEMORY_CAP = 5000;
const REDIS_TIMEOUT_MS = 1500;

const key = (eventId: string) => `live:seats:${eventId}`;

const memoria = new Map<string, Map<string, { seat: Seat; at: number }>>();

function sameSeat(a: Seat, b: Seat): boolean {
  if (a.k !== b.k) return false;
  if (a.k === 'primary' || a.k === 'conflict') return true;
  return a.id === (b as { id: string }).id;
}

function parseSeat(raw: string | null | undefined): Seat | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { k?: unknown; id?: unknown };
    if (v.k === 'primary' || v.k === 'conflict') return { k: v.k };
    if ((v.k === 'reg' || v.k === 'fwd' || v.k === 'grant') && typeof v.id === 'string') {
      return { k: v.k, id: v.id };
    }
  } catch {
    /* riga illeggibile: come se non ci fosse */
  }
  return null;
}

function memoriaEvento(eventId: string): Map<string, { seat: Seat; at: number }> {
  // Scade tutto quello che ha superato la durata, in ogni evento: un evento
  // finito non si rilegge piu', e non deve restare in memoria.
  const scadenza = Date.now() - SEATS_TTL_SECONDS * 1000;
  for (const [ev, posti] of memoria) {
    for (const [id, v] of posti) if (v.at < scadenza) posti.delete(id);
    if (posti.size === 0 && ev !== eventId) memoria.delete(ev);
  }
  let m = memoria.get(eventId);
  if (!m) {
    m = new Map();
    memoria.set(eventId, m);
  }
  return m;
}

const CONFLITTO = JSON.stringify({ k: 'conflict' } satisfies Seat);

/**
 * Lega l'endpoint al posto. Vero se ora e' suo (anche se lo era gia'); falso
 * se l'endpoint era di un altro posto: da quel momento e' conteso.
 */
export async function claimSeat(eventId: string, endpointId: string, seat: Seat): Promise<boolean> {
  const valore = JSON.stringify(seat);
  const redis = getRedis();
  if (redis) {
    const esito = await withDeadline(
      redis
        .multi()
        .hsetnx(key(eventId), endpointId, valore)
        .hget(key(eventId), endpointId)
        .expire(key(eventId), SEATS_TTL_SECONDS)
        .exec(),
      REDIS_TIMEOUT_MS,
      null,
    );
    if (esito) {
      const attuale = parseSeat(esito[1]?.[1] as string | null);
      if (attuale && sameSeat(attuale, seat)) return true;
      await withDeadline(redis.hset(key(eventId), endpointId, CONFLITTO), REDIS_TIMEOUT_MS, 0);
      return false;
    }
    // Redis non risponde: si ripiega sulla memoria, come senza Redis.
  }
  const m = memoriaEvento(eventId);
  const prima = m.get(endpointId);
  if (prima && !sameSeat(prima.seat, seat)) {
    m.set(endpointId, { seat: { k: 'conflict' }, at: Date.now() });
    return false;
  }
  if (!prima && m.size >= MEMORY_CAP) return false;
  m.set(endpointId, { seat, at: Date.now() });
  return true;
}

/** Gli endpoint dichiarati nell'evento, con il loro posto. */
export async function readSeats(eventId: string): Promise<Record<string, Seat>> {
  const out: Record<string, Seat> = {};
  const redis = getRedis();
  if (redis) {
    const tutti = await withDeadline(redis.hgetall(key(eventId)), REDIS_TIMEOUT_MS, null);
    if (tutti) {
      for (const [id, raw] of Object.entries(tutti)) {
        const seat = parseSeat(raw);
        if (seat) out[id] = seat;
      }
      return out;
    }
  }
  for (const [id, v] of memoriaEvento(eventId)) out[id] = v.seat;
  return out;
}

/** Solo per i test: svuota la memoria del processo. */
export function resetSeatsMemoryForTests(): void {
  memoria.clear();
}
