/**
 * Fan-out dell'indicatore «sta scrivendo» — canale `chat-typing:<eventId>`.
 *
 * CANALE SEPARATO da `chat:<eventId>`, e non per ordine. Lo stream SSE riemette
 * come `event: message` tutto quello che arriva su `chat:`, e il client tratta
 * ogni `message` come un messaggio da aggiungere alla lista. Durante un rolling
 * update gli stream dei pod della versione precedente leggono quel canale: un
 * avviso di digitazione pubblicato lì comparirebbe in sala come una bolla
 * vuota. Questo canale lo ascoltano solo gli stream che lo consegnano come
 * `event: typing`.
 *
 * EFFIMERO: niente database, niente replay, nessun riallineamento quando la
 * connessione di ascolto torna. Un avviso perso costa qualche secondo di
 * indicatore mancante; chi legge spegne da sé chi non rinnova l'avviso
 * (lib/chat/typing).
 *
 * COSA VIAGGIA: la chiave opaca del mittente (`senderColourKey`) e il nome che
 * la sala vede già accanto ai suoi messaggi. Mai l'id grezzo: per un ospite
 * deriva dal suo indirizzo IP, e questo avviso arriva a ogni lettore.
 *
 * SENZA REDIS pubblicare e ascoltare non fanno nulla e non sollevano: la chat
 * funziona, l'indicatore manca. È il caso dello stack locale.
 */

import { getRedis, getRedisSubscriber } from '@/lib/redis';
import { parseTypingPayload, type TypingPayload } from '@/lib/chat/typing';

function channel(eventId: string): string {
  return `chat-typing:${eventId}`;
}

/**
 * Un solo ascoltatore per processo, non uno per connessione: lo stream della
 * chat lo apre ogni partecipante, e un gestore per connessione farebbe girare
 * centinaia di funzioni per ogni avviso. Il gestore unico smista sul registro.
 */
const registro = new Map<string, Set<(payload: TypingPayload) => void>>();
let ascoltatoreAttivo = false;

function smista(receivedChannel: string, raw: string): void {
  const iscritti = registro.get(receivedChannel);
  if (!iscritti || iscritti.size === 0) return;

  let payload: TypingPayload | null;
  try {
    payload = parseTypingPayload(JSON.parse(raw));
  } catch {
    payload = null;
  }
  // Malformato: si scarta in silenzio, come per la chat.
  if (!payload) return;

  for (const iscritto of iscritti) {
    try {
      iscritto(payload);
    } catch {
      // Un consumatore che esplode non deve impedire la consegna agli altri.
    }
  }
}

/**
 * Pubblica «sta scrivendo» a tutti gli stream della chat aperti nel cluster.
 * Non solleva mai e non aspetta una connessione che non è pronta: il client
 * Redis accoda i comandi all'infinito (`maxRetriesPerRequest: null`) e un
 * avviso vecchio di qualche secondo non serve più a nessuno.
 */
export async function publishTyping({
  eventId,
  senderKey,
  senderName,
}: {
  eventId: string;
  senderKey: string;
  senderName: string;
}): Promise<number> {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return 0;
  const payload: TypingPayload = { senderKey, senderName };
  try {
    return await redis.publish(channel(eventId), JSON.stringify(payload));
  } catch {
    return 0;
  }
}

/**
 * Ascolta `chat-typing:<eventId>`. Restituisce la funzione di distacco che lo
 * stream DEVE chiamare alla chiusura, altrimenti il registro cresce a ogni
 * connessione.
 *
 * Non solleva: se l'iscrizione su Redis fallisce il consumatore esce dal
 * registro e si riceve un distacco innocuo. Lo stream della chat non deve
 * cadere per un indicatore accessorio.
 */
export async function subscribeTyping(
  eventId: string,
  onTyping: (payload: TypingPayload) => void,
): Promise<() => void> {
  const sub = getRedisSubscriber();
  if (!sub) return () => {};

  const ch = channel(eventId);

  if (!ascoltatoreAttivo) {
    sub.on('message', smista);
    ascoltatoreAttivo = true;
  }

  let iscritti = registro.get(ch);
  if (!iscritti) {
    iscritti = new Set();
    registro.set(ch, iscritti);
  }
  iscritti.add(onTyping);

  const stacca = (): void => {
    const insieme = registro.get(ch);
    if (!insieme || !insieme.delete(onTyping) || insieme.size > 0) return;
    // Ultimo ascoltatore locale andato via: si lascia anche il canale su Redis,
    // altrimenti questo processo riceverebbe per sempre gli avvisi di ogni
    // evento seguito una volta sola.
    registro.delete(ch);
    void sub.unsubscribe(ch).catch(() => {
      // Una disiscrizione fallita lascia arrivare avvisi senza ascoltatori:
      // il registro li scarta, quindi è innocuo.
    });
  };

  try {
    await sub.subscribe(ch);
  } catch {
    stacca();
    return () => {};
  }
  return stacca;
}

/** Solo per i test: riporta il modulo allo stato iniziale. */
export function __resetTypingRegistry(): void {
  registro.clear();
  ascoltatoreAttivo = false;
}
