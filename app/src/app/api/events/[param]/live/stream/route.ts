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
 * APERTURA. Subito dopo il commento di apertura arrivano `hello`, `flags` e
 * `eventStatus` letti dal database: chi entra a metà evento non aspetta il
 * primo cambiamento per essere allineato. `hello` dice anche se il push è
 * davvero disponibile — senza Redis lo stream resta muto, e il client deve
 * saperlo per non spegnere il proprio polling.
 */

import { prisma } from '@/lib/db';
import { eventParamWhere } from '@/lib/events/event-param';
import { isEventPubliclyVisible } from '@/lib/events/visibility';
import { subscribeLiveState, type LiveEnvelope } from '@/lib/live-state/pubsub';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';
// Lo stream resta aperto per la durata della call (Next pretende un letterale).
export const maxDuration = 3600;

// Commento di keepalive ogni 25s: il proxy chiude a 60s di silenzio, e qui il
// silenzio è il caso normale.
const KEEPALIVE_MS = 25_000;

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
      const invia = (envelope: LiveEnvelope | { op: 'hello'; pushAvailable: boolean }) => {
        const payload = `event: message\n` + `data: ${JSON.stringify(envelope)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Controller già chiuso (client sparito). Si ignora.
        }
      };

      // Commento di apertura: EventSource passa a OPEN al primo byte.
      controller.enqueue(encoder.encode(`: connected to live:${eventId}\n\n`));

      const ora = new Date().toISOString();
      invia({ op: 'hello', pushAvailable: getRedis() !== null });
      invia({
        op: 'flags',
        flags: {
          qaEnabled: event.qaEnabled,
          chatEnabled: event.chatEnabled,
          agendaEnabled: event.agendaEnabled,
          wordCloudEnabled: event.wordCloudEnabled,
          recordingEnabled: event.recordingEnabled,
        },
        ts: ora,
      });
      invia({ op: 'eventStatus', status: event.status, ts: ora });

      // Ci si iscrive PRIMA di armare il keepalive: se l'iscrizione fallisce,
      // l'intervallo non resta orfano su uno stream mezzo aperto.
      try {
        cleanup = await subscribeLiveState(eventId, invia);
      } catch {
        closed();
        try {
          controller.close();
        } catch {
          /* già chiuso */
        }
        return;
      }
      // Se il client se n'è andato mentre attendevamo l'iscrizione, closed() è
      // già passato con cleanup ancora nullo e non ha potuto staccare nulla.
      if (closedOnce) {
        cleanup();
        cleanup = null;
        return;
      }
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          /* stream chiuso */
        }
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
