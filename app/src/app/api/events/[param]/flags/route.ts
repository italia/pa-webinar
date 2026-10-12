/**
 * GET /api/events/[slug]/flags — feature flag correnti dell'evento.
 *
 * Serve all'attivazione/disattivazione delle funzioni DURANTE l'evento
 * (punto d): i flag vengono passati al client solo al mount, quindi il
 * client live polla questo endpoint (SWR, intervallo breve) per reagire
 * quando un moderatore cambia una funzione. Dati non sensibili (config di
 * stanza), nessun token richiesto oltre all'esistenza dell'evento.
 *
 * Con `?orologio=registrazione` aggiunge `recordingStartedAt`: quando è partita
 * la registrazione in corso, secondo la cronologia della sala (live_actions,
 * riferita da chi modera); null se l'ultima voce è un arresto o non c'è. Serve
 * alla durata della registrazione nella striscia del tempo, uguale per tutti i
 * moderatori; le altre letture dei flag non pagano la query in più.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      qaEnabled: true,
      chatEnabled: true,
      agendaEnabled: true,
      wordCloudEnabled: true,
      liveCaptionsEnabled: true,
      recordingEnabled: true,
    },
  });
  if (!event) throw new NotFoundError('Event');
  const { id: _id, ...flags } = event;
  if (new URL(request.url).searchParams.get('orologio') !== 'registrazione') {
    return Response.json(flags);
  }
  const ultima = await prisma.liveAction.findFirst({
    where: { eventId: event.id, kind: { in: ['recording.started', 'recording.stopped'] } },
    orderBy: { at: 'desc' },
    select: { kind: true, at: true },
  });
  return Response.json({
    ...flags,
    recordingStartedAt: ultima?.kind === 'recording.started' ? ultima.at.toISOString() : null,
  });
});
