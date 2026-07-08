/**
 * GET /api/events/[slug]/flags — feature flag correnti dell'evento.
 *
 * Serve all'attivazione/disattivazione delle funzioni DURANTE l'evento
 * (punto d): i flag vengono passati al client solo al mount, quindi il
 * client live polla questo endpoint (SWR, intervallo breve) per reagire
 * quando un moderatore cambia una funzione. Dati non sensibili (config di
 * stanza), nessun token richiesto oltre all'esistenza dell'evento.
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
      qaEnabled: true,
      chatEnabled: true,
      agendaEnabled: true,
      wordCloudEnabled: true,
      recordingEnabled: true,
    },
  });
  if (!event) throw new NotFoundError('Event');
  return Response.json(event);
});
