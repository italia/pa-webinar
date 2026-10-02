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

import { getRedis, getRedisSubscriber, withDeadline } from '@/lib/redis';

/**
 * I pannelli che si limitano a dire «rileggi». Due motivi distinti per starci:
 * la visibilità dipende dal RUOLO (Q&A e sondaggi: chi ha votato, cosa è stato
 * archiviato, i conteggi nascosti fino alla chiusura; materiali: chi conduce li
 * vede tutti, il pubblico solo quelli della fase in corso) oppure la risposta
 * contiene un campo PER-UTENTE (agenda e word cloud: la propria reazione, la
 * propria parola). In entrambi i casi uno snapshot unico scritto nella cache
 * condivisa mostrerebbe a qualcuno lo stato di qualcun altro.
 */
export type PokeablePanel = 'qa' | 'polls' | 'agenda' | 'wordcloud' | 'materials';

export const POKEABLE_PANELS: readonly PokeablePanel[] = [
  'qa',
  'polls',
  'agenda',
  'wordcloud',
  'materials',
];

/**
 * Gli interruttori attivabili durante l'evento. L'elenco è quello servito da
 * `GET /api/events/[param]/flags`: è quella la fonte che il client legge, e le
 * due cose devono restare identiche — un flag qui e non lì arriverebbe al
 * client in una forma che il polling di riserva non sa produrre.
 */
export const LIVE_FLAG_FIELDS = [
  'qaEnabled',
  'chatEnabled',
  'agendaEnabled',
  'wordCloudEnabled',
  'recordingEnabled',
] as const;

export type LiveFlagField = (typeof LIVE_FLAG_FIELDS)[number];

/** Derivato dall'elenco: un flag si aggiunge in un posto solo. */
export type LiveFlags = Record<LiveFlagField, boolean>;

export type LiveEnvelope =
  | { op: 'flags'; flags: LiveFlags; ts: string }
  | { op: 'eventStatus'; status: string; ts: string }
  | { op: 'poke'; panel: PokeablePanel; ts: string };

/**
 * Cio' che riceve chi si iscrive: le buste pubblicate, piu' `resync`, che non
 * viaggia su Redis ma nasce in questo processo quando la connessione di
 * ascolto torna dopo un'interruzione. Le buste pubblicate nel frattempo sono
 * perse: lo stream rilegge lo stato e lo rimanda.
 */
export type LiveStreamEvent = LiveEnvelope | { op: 'resync' };

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
const registro = new Map<string, Set<(envelope: LiveStreamEvent) => void>>();
let ascoltatoreAttivo = false;

/** Avvisa ogni iscritto locale che la connessione di ascolto e' tornata. */
function riallinea(): void {
  for (const iscritti of registro.values()) {
    for (const iscritto of iscritti) {
      try {
        iscritto({ op: 'resync' });
      } catch {
        // Un consumatore che esplode non deve impedire la consegna agli altri.
      }
    }
  }
}

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

/** Quanto si aspetta una connessione che si sta aprendo, prima di rinunciare. */
const READY_WAIT_MS = 2000;

type ClientConStato = {
  status: string;
  once?: (evento: 'ready', fn: () => void) => unknown;
};

/** Un'attesa sola per connessione: chi aspetta la stessa si aggancia a quella. */
const attesePronte = new WeakMap<object, Promise<void>>();

function prontezza(redis: ClientConStato): Promise<void> {
  const inCorso = attesePronte.get(redis);
  if (inCorso) return inCorso;
  const attesa = new Promise<void>((resolve) => {
    redis.once!('ready', () => {
      attesePronte.delete(redis);
      resolve();
    });
  });
  attesePronte.set(redis, attesa);
  return attesa;
}

/**
 * Vero quando la connessione e' pronta, aspettandola fino a `ms` se si sta
 * aprendo: il client nasce alla prima richiesta che lo usa (lib/redis), quindi
 * il primo avviso dopo un avvio o una riconnessione trova la connessione
 * ancora in apertura. Tutti quelli che aspettano la stessa connessione
 * condividono un solo ascoltatore, per quanti siano.
 */
async function connessionePronta(redis: ClientConStato, ms: number): Promise<boolean> {
  if (redis.status === 'ready') return true;
  if (redis.status === 'end' || redis.status === 'close' || !redis.once) return false;
  return withDeadline(
    prontezza(redis).then(() => true),
    ms,
    false
  );
}

/**
 * Vero se la connessione per pubblicare e' pronta, aspettandola fino a `ms`.
 * Lo usa lo stream per dire al client se il push e' disponibile: senza
 * attesa, chi apriva il canale mentre la connessione nasceva restava a
 * interrogare il server per tutta la sessione.
 */
export async function liveRedisReady(ms: number): Promise<boolean> {
  const redis = getRedis();
  return !!redis && (await connessionePronta(redis, ms));
}

/**
 * Pubblica uno snapshot (o un poke) a tutti gli stream aperti nel cluster.
 * Non solleva mai: un pannello che non si aggiorna è un fastidio, una mutazione
 * che fallisce perché Redis è lento è un danno. I chiamanti non attendono
 * (lib/live-state/publish), quindi l'attesa di una connessione in apertura non
 * rallenta nessuna mutazione; oltre l'attesa si rinuncia, perché il client
 * ioredis è configurato per accodare i comandi all'infinito
 * (`maxRetriesPerRequest: null`) invece di rifiutarli.
 */
export async function publishLiveState(
  eventId: string,
  envelope: LiveEnvelope
): Promise<number> {
  const redis = getRedis();
  if (!redis || !(await connessionePronta(redis, READY_WAIT_MS))) return 0;
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
  onMessage: (envelope: LiveStreamEvent) => void
): Promise<() => void> {
  const sub = getRedisSubscriber();
  if (!sub) return () => {};

  const ch = channel(eventId);

  if (!ascoltatoreAttivo) {
    sub.on('message', smista);
    // ioredis ripete le iscrizioni da solo quando la connessione torna, ma
    // cio' che e' stato pubblicato durante il buco non arriva piu': ogni
    // 'ready' dopo il primo chiede agli stream di riallinearsi.
    let primaConnessione = sub.status !== 'ready';
    sub.on('ready', () => {
      if (primaConnessione) {
        primaConnessione = false;
        return;
      }
      riallinea();
    });
    ascoltatoreAttivo = true;
  }

  let iscritti = registro.get(ch);
  if (!iscritti) {
    iscritti = new Set();
    registro.set(ch, iscritti);
  }
  iscritti.add(onMessage);

  try {
    await sub.subscribe(ch);
  } catch (err) {
    // Iscrizione fallita: il consumatore non resta nel registro senza nessuno
    // che possa staccarlo.
    iscritti.delete(onMessage);
    if (iscritti.size === 0) registro.delete(ch);
    throw err;
  }

  return () => {
    const insieme = registro.get(ch);
    if (!insieme) return;
    insieme.delete(onMessage);
    if (insieme.size > 0) return;

    // Ultimo ascoltatore locale andato via: si lascia anche il canale su Redis.
    // Restare iscritti costerebbe traffico verso questo processo per ogni
    // evento a cui ha assistito una volta sola, e la sottoscrizione non scade
    // da sé finché la connessione resta aperta — che è per sempre.
    registro.delete(ch);
    void sub.unsubscribe(ch).catch(() => {
      // Se la disiscrizione fallisce si riceveranno messaggi senza ascoltatori:
      // vengono scartati dal registro, quindi è innocuo.
    });
  };
}

/** Solo per i test: riporta il modulo allo stato iniziale. */
export function __resetLiveStateRegistry(): void {
  registro.clear();
  ascoltatoreAttivo = false;
}
