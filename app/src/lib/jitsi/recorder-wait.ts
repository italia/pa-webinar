/**
 * Da quando si aspetta il registratore, e quando smettere di dire «in avvio».
 *
 * Il registratore (Jibri) si accende a richiesta: lo scaler lo porta a una
 * replica quando un evento con la registrazione e' in diretta o in
 * allestimento, e la pagina di stato lo dichiara «in avvio» (`scaling`)
 * finche' la sua API di salute non risponde. Se non risponde mai — un nodo che
 * non arriva, un'immagine che non si scarica, un processo che non parte, una
 * URL di salute non impostata — «in avvio» resterebbe scritto per tutta la
 * durata dell'evento. Questo modulo tiene l'orologio dell'attesa, cosi' la
 * rotta di stato puo' dire, passato il tempo massimo, che il registratore non
 * e' partito.
 *
 * L'orologio e' condiviso: sta in Redis, perche' ogni replica
 * dell'applicazione deve dare la stessa risposta a ogni moderatore. E' tenuto
 * per evento, in un solo hash. Un evento che si aggiunge a un'attesa in corso
 * ne eredita l'inizio: il registratore e' uno, e nessuno ha smesso di
 * chiederlo. Un evento che arriva quando nessuno degli eventi in corso lo sta
 * aspettando parte da zero, anche se l'attesa di un evento appena concluso
 * non e' ancora scaduta: nel frattempo lo scaler puo' aver spento e riacceso
 * il registratore. La risposta e' l'inizio piu' vecchio fra gli eventi che
 * aspettano adesso.
 *
 * L'hash si rinnova a ogni richiesta mentre si aspetta e scade se per qualche
 * minuto nessuno chiede lo stato; si cancella appena il registratore risponde
 * o nessun evento lo chiede piu'.
 *
 * Senza Redis, o con Redis che non risponde, vale lo stesso orologio tenuto in
 * memoria dal processo, riallineato a quello di Redis a ogni risposta: una
 * replica che ha gia' parlato con Redis continua a dare la stessa risposta
 * delle altre; una appena avviata parte dalla propria prima richiesta.
 */
import { getRedis, withDeadline } from '@/lib/redis';

export const RECORDER_WAIT_KEY = 'jibri:waiting-since';

/** Senza richieste per questo tempo l'attesa si considera abbandonata. */
export const RECORDER_WAIT_IDLE_SECONDS = 300;

const IDLE_MS = RECORDER_WAIT_IDLE_SECONDS * 1000;
const REDIS_TIMEOUT_MS = 1000;

/** Inizio dell'attesa per evento, e ultima richiesta vista. */
let inMemoria: { seen: number; eventi: Map<string, number> } | null = null;

/** Per evento che aspetta, l'inizio della sua attesa: `null` se non e' noto. */
type Inizi<T extends number | null> = ReadonlyArray<readonly [id: string, since: T]>;

/**
 * Gli inizi degli eventi che aspettano adesso, dati quelli gia' noti: chi ce
 * l'ha lo tiene, chi non ce l'ha eredita il piu' vecchio degli altri, oppure
 * parte adesso se nessun altro ne ha uno.
 */
function completaInizi(noti: Inizi<number | null>, now: number): Inizi<number> {
  const presenti = noti.flatMap(([, since]) => (since === null ? [] : [since]));
  const ereditato = presenti.length > 0 ? Math.min(...presenti) : now;
  return noti.map(([id, since]) => [id, since ?? ereditato] as const);
}

/** L'inizio piu' vecchio. Un orologio di un'altra replica puo' essere avanti
 *  di poco: un inizio nel futuro vale come «adesso». */
function piuVecchio(inizi: Inizi<number>, now: number): number {
  return Math.min(now, ...inizi.map(([, since]) => since));
}

function orologioLocale(
  eventIds: readonly string[],
  waiting: boolean,
  now: number,
): number | null {
  if (!waiting) {
    inMemoria = null;
    return null;
  }
  if (!inMemoria || now - inMemoria.seen > IDLE_MS) {
    inMemoria = { seen: now, eventi: new Map() };
  }
  const memoria = inMemoria;
  memoria.seen = now;
  const inizi = completaInizi(
    eventIds.map((id) => [id, memoria.eventi.get(id) ?? null] as const),
    now,
  );
  for (const [id, since] of inizi) memoria.eventi.set(id, since);
  return piuVecchio(inizi, now);
}

/** Il risultato di un HMGET dentro un MULTI, o `null` se non e' arrivato. */
function leggiInizi(
  risposta: [Error | null, unknown] | undefined,
  eventIds: readonly string[],
): Inizi<number | null> | null {
  if (!risposta || risposta[0] || !Array.isArray(risposta[1])) return null;
  const valori: unknown[] = risposta[1];
  if (valori.length !== eventIds.length) return null;
  return eventIds.map((id, i) => {
    const valore = valori[i];
    const n = typeof valore === 'string' ? Number(valore) : Number.NaN;
    return [id, Number.isFinite(n) && n > 0 ? n : null] as const;
  });
}

/**
 * Registra quali eventi stanno aspettando il registratore (o che l'attesa e'
 * finita) e restituisce da quando si aspetta, in millisecondi epoch; `null`
 * quando non si aspetta.
 *
 * @param eventIds gli eventi che chiedono il registratore adesso
 * @param waiting  `false` quando il registratore risponde
 */
export async function recorderWaitingSince(
  eventIds: readonly string[],
  waiting: boolean,
  now: number = Date.now(),
): Promise<number | null> {
  const inAttesa = waiting && eventIds.length > 0;
  const locale = orologioLocale(eventIds, inAttesa, now);

  const redis = getRedis();
  // `status !== 'ready'`: il client accoda i comandi senza scadenza quando
  // Redis non c'e' (vedi lib/redis), e questa rotta la interroga ogni
  // partecipante di una diretta ogni pochi secondi.
  if (!redis || redis.status !== 'ready') return locale;

  if (!inAttesa) {
    await withDeadline(redis.del(RECORDER_WAIT_KEY), REDIS_TIMEOUT_MS, 0);
    return null;
  }

  // Primo giro: rinnova la scadenza e legge gli inizi gia' scritti, anche da
  // un'altra replica. A regime e' l'unico.
  const primo = await withDeadline(
    redis
      .multi()
      .expire(RECORDER_WAIT_KEY, RECORDER_WAIT_IDLE_SECONDS)
      .hmget(RECORDER_WAIT_KEY, ...eventIds)
      .exec(),
    REDIS_TIMEOUT_MS,
    null,
  );
  const noti = leggiInizi(primo?.[1], eventIds);
  if (!noti) return locale;

  let inizi = completaInizi(noti, now);
  const mancanti = new Set(noti.flatMap(([id, since]) => (since === null ? [id] : [])));
  if (mancanti.size > 0) {
    // Secondo giro, per gli eventi che non hanno ancora un inizio: HSETNX lo
    // scrive solo se nessuno l'ha scritto nel frattempo, HMGET rilegge quello
    // che ha vinto; EXPIRE perche' HSETNX su un hash nuovo lo crea senza
    // scadenza.
    const tx = redis.multi();
    for (const [id, since] of inizi) {
      if (mancanti.has(id)) tx.hsetnx(RECORDER_WAIT_KEY, id, String(since));
    }
    tx.expire(RECORDER_WAIT_KEY, RECORDER_WAIT_IDLE_SECONDS).hmget(RECORDER_WAIT_KEY, ...eventIds);
    const secondo = await withDeadline(tx.exec(), REDIS_TIMEOUT_MS, null);
    const riletti = leggiInizi(secondo?.at(-1), eventIds);
    if (riletti) inizi = completaInizi(riletti, now);
  }

  // L'orologio in memoria segue Redis: se Redis poi non risponde, questa
  // replica continua a dare la stessa risposta delle altre.
  const memoria = inMemoria;
  if (memoria) for (const [id, since] of inizi) memoria.eventi.set(id, since);

  return piuVecchio(inizi, now);
}

/** Solo per i test: azzera l'orologio in memoria. */
export function __resetRecorderWait(): void {
  inMemoria = null;
}
