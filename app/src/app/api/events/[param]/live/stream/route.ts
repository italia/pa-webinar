/**
 * Flusso SSE dello stato dei pannelli della sala live.
 *
 * Terzo stream accanto a chat e controlli, e separato per la stessa ragione per
 * cui quelli lo sono: resta aperto per tutta la sessione anche quando la chat è
 * spenta da un moderatore, e il contratto della chat non viene toccato.
 *
 * COSA MANDA. Snapshot per ciò che è uguale per tutti (flag, stato dell'evento,
 * agenda, word cloud) e semplici notifiche di cambiamento per Q&A e sondaggi,
 * dove la stessa rotta risponde diversamente a seconda del ruolo — vedi
 * lib/live-state/pubsub.
 *
 * AUTORIZZAZIONE. Come i materiali: basta che l'evento sia pubblicamente
 * visibile. Nessun token in query, che finirebbe nei log di accesso di ogni
 * proxy attraversato.
 *
 * APERTURA. Subito dopo il commento di apertura arriva `hello`, che dice se il
 * push è davvero disponibile — senza Redis lo stream resta muto, e il client
 * deve saperlo per non spegnere il proprio polling. Poi `flags` ed
 * `eventStatus` letti dal database: chi entra a metà evento non aspetta il
 * primo cambiamento per essere allineato.
 *
 * L'istantanea si legge dopo l'iscrizione a Redis (atteso al massimo tre
 * secondi), e gli avvisi arrivati durante la lettura partono dopo di lei,
 * nell'ordine: nessun cambio cade fra la lettura e l'ascolto. Quando la
 * connessione di ascolto torna dopo un'interruzione, lo stream rimanda lo
 * stato e fa rileggere ogni pannello (`resync`, lib/live-state/pubsub).
 */

import { prisma } from '@/lib/db';
import { eventParamWhere } from '@/lib/events/event-param';
import { isEventPubliclyVisible } from '@/lib/events/visibility';
import {
  subscribeLiveState,
  LIVE_FLAG_FIELDS,
  POKEABLE_PANELS,
  liveRedisReady,
  type LiveEnvelope,
  type LiveFlagField,
  type LiveFlags,
  type LiveStreamEvent,
} from '@/lib/live-state/pubsub';
import { withDeadline } from '@/lib/redis';

export const dynamic = 'force-dynamic';
// Lo stream resta aperto per la durata della call (Next pretende un letterale).
export const maxDuration = 3600;

// Battito ogni 25s: il proxy chiude a 60s di silenzio, e qui il silenzio è il
// caso normale. È un MESSAGGIO, non un commento: `EventSource` non consegna i
// commenti a `onmessage`, quindi un battito commentato tiene viva la
// connessione ma lascia il client convinto che il canale sia morto.
const KEEPALIVE_MS = 25_000;

/** Attesa massima della connessione per dire se il push e' disponibile. */
const HELLO_WAIT_MS = 1_000;

/** Attesa massima dell'iscrizione a Redis prima di mandare comunque lo stato. */
const SUBSCRIBE_WAIT_MS = 3_000;

type StatoLive = { status: string } & Record<LiveFlagField, boolean>;

function leggiStato(eventId: string): Promise<StatoLive | null> {
  return prisma.event
    .findUnique({
      where: { id: eventId },
      select: {
        status: true,
        qaEnabled: true,
        chatEnabled: true,
        agendaEnabled: true,
        wordCloudEnabled: true,
        liveCaptionsEnabled: true,
        recordingEnabled: true,
      },
    })
    .catch(() => null);
}

/**
 * Lettura condivisa per il riallineamento: quando la connessione di ascolto
 * torna, tutti gli stream dello stesso evento in questo processo si
 * riallineano insieme, e una lettura sola basta a tutti.
 */
const riallineamentiInCorso = new Map<string, Promise<StatoLive | null>>();
function statoPerRiallineamento(eventId: string): Promise<StatoLive | null> {
  const inCorso = riallineamentiInCorso.get(eventId);
  if (inCorso) return inCorso;
  const lettura = leggiStato(eventId).finally(() => riallineamentiInCorso.delete(eventId));
  riallineamentiInCorso.set(eventId, lettura);
  return lettura;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ param: string }> },
) {
  const { param } = await context.params;

  const event = await prisma.event.findFirst({
    where: eventParamWhere(param),
    select: {
      id: true,
      status: true,
      // Campi richiesti da isEventPubliclyVisible: un evento concluso resta
      // raggiungibile solo se la pagina post-evento è accesa e non scaduta.
      eventType: true,
      endsAt: true,
      postEventPublic: true,
      postEventPublicUntil: true,
      qaEnabled: true,
      chatEnabled: true,
      agendaEnabled: true,
      wordCloudEnabled: true,
      liveCaptionsEnabled: true,
      recordingEnabled: true,
    },
  });
  if (!event || !isEventPubliclyVisible(event)) {
    return new Response('Event not found', { status: 404 });
  }
  const eventId: string = event.id;

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const invia = (
        envelope:
          | LiveEnvelope
          | { op: 'hello'; pushAvailable: boolean }
          | { op: 'ping'; ts: string },
      ) => {
        const payload = `event: message\n` + `data: ${JSON.stringify(envelope)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Controller già chiuso (client sparito). Si ignora.
        }
      };

      // Commento di apertura: EventSource passa a OPEN al primo byte.
      controller.enqueue(encoder.encode(`: connected to live:${eventId}\n\n`));

      // Non basta che il client esista: `publishLiveState` pubblica solo a
      // connessione pronta, quindi annunciare la disponibilità sulla sola
      // esistenza spegnerebbe il polling proprio mentre Redis è irraggiungibile.
      // Una connessione che sta nascendo si aspetta fino a un secondo.
      invia({ op: 'hello', pushAvailable: await liveRedisReady(HELLO_WAIT_MS) });

      const inviaStato = (stato: StatoLive) => {
        const ora = new Date().toISOString();
        invia({
          op: 'flags',
          flags: Object.fromEntries(
            LIVE_FLAG_FIELDS.map((campo) => [campo, stato[campo]]),
          ) as LiveFlags,
          ts: ora,
        });
        invia({ op: 'eventStatus', status: stato.status, ts: ora });
      };

      // Mentre si legge lo stato (all'apertura o a un riallineamento) gli
      // avvisi si mettono da parte e partono dopo, nell'ordine: un avviso
      // arrivato durante la lettura e' piu' recente o uguale, cosi' l'ultimo
      // stato che arriva al client e' quello giusto.
      let inLettura = true;
      const inAttesa: LiveEnvelope[] = [];
      const svuota = () => {
        inLettura = false;
        for (const envelope of inAttesa.splice(0)) invia(envelope);
      };

      const ricevi = (evento: LiveStreamEvent) => {
        if (evento.op === 'resync') {
          // La connessione di ascolto e' tornata: quanto pubblicato nel buco e'
          // perso. Si rimanda lo stato e si fa rileggere ogni pannello.
          if (inLettura || closedOnce) return;
          inLettura = true;
          void statoPerRiallineamento(eventId).then((stato) => {
            if (closedOnce) return;
            if (stato) {
              inviaStato(stato);
              const ora = new Date().toISOString();
              for (const panel of POKEABLE_PANELS) invia({ op: 'poke', panel, ts: ora });
            }
            svuota();
          });
          return;
        }
        if (inLettura) inAttesa.push(evento);
        else invia(evento);
      };

      // L'iscrizione a Redis viene prima dell'istantanea, cosi' nessun cambio
      // cade fra la lettura e l'ascolto. Ha pero' un limite di attesa: con la
      // connessione di ascolto giu' il comando resterebbe in coda per sempre, e
      // il client non riceverebbe nemmeno flag e stato.
      const esito: { iscrizione: 'attesa' | 'fatta' | 'fallita'; scaduta: boolean } = {
        iscrizione: 'attesa',
        scaduta: false,
      };
      const chiudi = () => {
        closed();
        try {
          controller.close();
        } catch {
          /* già chiuso */
        }
      };
      const iscrizione = subscribeLiveState(eventId, ricevi).then(
        (stacca) => {
          esito.iscrizione = 'fatta';
          // Il client se n'e' andato mentre si attendeva: si stacca subito.
          if (closedOnce) {
            stacca();
            return;
          }
          cleanup = stacca;
          // Arrivata oltre il limite: ora il push funziona davvero.
          if (esito.scaduta) invia({ op: 'hello', pushAvailable: true });
        },
        () => {
          esito.iscrizione = 'fallita';
          // Fallita dopo il limite: il client aveva gia' lo stato. Si chiude,
          // cosi' riapre il canale (e, senza push, torna a interrogare).
          if (esito.scaduta) chiudi();
        },
      );
      await withDeadline(iscrizione, SUBSCRIBE_WAIT_MS, undefined);
      if (esito.iscrizione === 'fallita') {
        chiudi();
        return;
      }
      if (closedOnce) return;
      if (esito.iscrizione === 'attesa') {
        // Ancora in attesa: finche' non arriva, il client non deve contare sul
        // push e continua a interrogare il server.
        esito.scaduta = true;
        invia({ op: 'hello', pushAvailable: false });
      }

      // Se la rilettura fallisce si usa la lettura dell'apertura.
      inviaStato((await leggiStato(eventId)) ?? event);
      svuota();

      // Il client puo' essersene andato durante la lettura: un intervallo
      // armato ora non lo fermerebbe piu' nessuno.
      if (closedOnce) return;
      keepalive = setInterval(() => {
        invia({ op: 'ping', ts: new Date().toISOString() });
      }, KEEPALIVE_MS);
    },
    cancel() {
      closed();
    },
  });

  // La pulizia gira una volta sola (possono scattare sia cancel() sia 'abort').
  let closedOnce = false;
  function closed() {
    if (closedOnce) return;
    closedOnce = true;
    if (cleanup) cleanup();
    if (keepalive) clearInterval(keepalive);
  }
  request.signal.addEventListener('abort', closed);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
