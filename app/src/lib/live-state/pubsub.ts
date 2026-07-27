/**
 * Fan-out dello stato dei pannelli della sala live — canale `live:<eventId>`.
 *
 * Terzo canale accanto a chat (`chat:`) e controlli (`control:`), tenuto
 * separato per lo stesso motivo per cui quelli lo sono fra loro: chi ascolta i
 * pannelli non riceve traffico di chat, e il contratto della chat non cambia.
 *
 * COSA VIAGGIA, E COSA NO. Due forme, e il confine è **chi vede cosa**:
 *   - **snapshot** solo dove la risposta è identica per tutti quelli che vedono
 *     l'evento (flag e stato): il client lo usa così com'è;
 *   - **poke** dove la risposta dipende dal ruolo (Q&A e sondaggi) o contiene un
 *     campo per-utente (agenda, word cloud). Lì il canale dice soltanto «è
 *     cambiato qualcosa» e a rispondere resta la rotta REST, con le
 *     autorizzazioni di chi chiede.
 * Mandare uno snapshot dove la risposta non è uguale per tutti significherebbe
 * tenere qui una seconda copia di quelle regole, e una divergenza non darebbe
 * errori: mostrerebbe a qualcuno lo stato di qualcun altro.
 *
 * SEMPRE SNAPSHOT, MAI DELTA: non c'è persistenza né replay, quindi un client
 * che si collega a metà evento — o che ha perso un messaggio — deve poter essere
 * corretto dal primo messaggio che riceve.
 *
 * SENZA REDIS non fallisce: pubblicare e sottoscrivere diventano operazioni
 * nulle, e i pannelli restano sul loro polling. È il caso dello stack locale.
 */

import { getRedis, getRedisSubscriber } from '@/lib/redis';

/**
 * I pannelli che si limitano a dire «rileggi». Due motivi distinti per starci:
 * la visibilità dipende dal RUOLO (Q&A e sondaggi: chi ha votato, cosa è stato
 * archiviato, i conteggi nascosti fino alla chiusura) oppure la risposta
 * contiene un campo PER-UTENTE (agenda e word cloud: la propria reazione, la
 * propria parola). In entrambi i casi uno snapshot unico scritto nella cache
 * condivisa mostrerebbe a qualcuno lo stato di qualcun altro.
 */
export type PokeablePanel = 'qa' | 'polls' | 'agenda' | 'wordcloud';

/**
 * Gli interruttori attivabili durante l'evento. L'elenco è quello servito da
 * `GET /api/events/[param]/flags`: è quella la fonte che il client legge, e le
 * due cose devono restare identiche — un flag qui e non lì arriverebbe al
 * client in una forma che il polling di riserva non sa produrre.
 */
export interface LiveFlags {
  qaEnabled: boolean;
  chatEnabled: boolean;
  agendaEnabled: boolean;
  wordCloudEnabled: boolean;
  recordingEnabled: boolean;
}

export type LiveEnvelope =
  | { op: 'flags'; flags: LiveFlags; ts: string }
  | { op: 'eventStatus'; status: string; ts: string }
  | { op: 'poke'; panel: PokeablePanel; ts: string };

function channel(eventId: string): string {
  return `live:${eventId}`;
}

/**
 * Un solo ascoltatore per processo, non uno per connessione.
 *
 * Questo stream lo apre OGNI partecipante: registrare un gestore per
 * connessione farebbe eseguire trecento funzioni per ogni messaggio e
 * supererebbe il limite di ascoltatori di Node, che comincerebbe a stampare
 * avvisi scambiati per una perdita di memoria. Qui il gestore è uno solo e
 * smista sul registro.
 */
const registro = new Map<string, Set<(envelope: LiveEnvelope) => void>>();
let ascoltatoreAttivo = false;

function smista(receivedChannel: string, payload: string): void {
  const iscritti = registro.get(receivedChannel);
  if (!iscritti || iscritti.size === 0) return;

  let envelope: LiveEnvelope;
  try {
    envelope = JSON.parse(payload) as LiveEnvelope;
  } catch {
    // Messaggio malformato: si scarta in silenzio, come chat e controlli.
    return;
  }
  for (const iscritto of iscritti) {
    try {
      iscritto(envelope);
    } catch {
      // Un consumatore che esplode non deve impedire la consegna agli altri.
    }
  }
}

/**
 * Pubblica uno snapshot (o un poke) a tutti gli stream aperti nel cluster.
 * Non solleva mai: un pannello che non si aggiorna è un fastidio, una mutazione
 * che fallisce perché Redis è lento è un danno. Con la connessione non pronta
 * si rinuncia subito, perché il client ioredis è configurato per accodare i
 * comandi all'infinito (`maxRetriesPerRequest: null`) invece di rifiutarli.
 */
export async function publishLiveState(
  eventId: string,
  envelope: LiveEnvelope,
): Promise<number> {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return 0;
  try {
    return await redis.publish(channel(eventId), JSON.stringify(envelope));
  } catch {
    return 0;
  }
}

/**
 * Ascolta `live:<eventId>`. Restituisce la funzione di distacco che lo stream
 * DEVE chiamare alla chiusura: senza, il registro cresce a ogni connessione.
 */
export async function subscribeLiveState(
  eventId: string,
  onMessage: (envelope: LiveEnvelope) => void,
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
  iscritti.add(onMessage);

  await sub.subscribe(ch);

  return () => {
    const insieme = registro.get(ch);
    if (!insieme) return;
    insieme.delete(onMessage);
    // Il canale resta sottoscritto su Redis: altri stream dello stesso pod
    // possono condividerlo, e Redis pulisce da sé i canali senza iscritti.
    if (insieme.size === 0) registro.delete(ch);
  };
}

/** Solo per i test: riporta il modulo allo stato iniziale. */
export function __resetLiveStateRegistry(): void {
  registro.clear();
  ascoltatoreAttivo = false;
}
