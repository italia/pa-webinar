/**
 * GET /api/events/[param]/recording/slides?m=<materialId> — il PDF di una
 * slide mostrata accanto alla registrazione pubblicata, per il visore della
 * pagina dell'evento (pdf.js) e per lo scaricamento.
 *
 * CHI. Chiunque veda la pagina post-evento: evento concluso con la pagina
 * pubblica (`isEventPageVisible`) e il video pubblicato.
 *
 * COSA. Solo un materiale che la pagina mostra accanto al video, ricalcolato
 * qui con le stesse regole (lib/presentation/recording-slides-data): presentato
 * in sala durante il tempo del video, ancora fra i materiali dell'evento,
 * visibile dopo l'evento, con i materiali mostrati sulla pagina e le slide
 * accese dallo staff su quella registrazione. Ogni altro `m` risponde 404,
 * senza dire perché.
 *
 * COME. Lato server, con lib/presentation/serve-pdf: il browser non raggiunge
 * lo storage e l'URL firmato non esce da qui.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError, RateLimitError } from '@/lib/errors';
import { eventParamWhere } from '@/lib/events/event-param';
import { isEventPageVisible } from '@/lib/events/visibility';
import { publicSlideFileKey } from '@/lib/presentation/recording-slides-data';
import { streamMaterialPdf } from '@/lib/presentation/serve-pdf';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { recordingSlidesFileQuerySchema } from '@/lib/validation/presentation';

export const dynamic = 'force-dynamic';

/**
 * Letture per indirizzo e minuto. Alto di proposito: dietro la rete di un
 * ufficio molte persone escono con lo stesso indirizzo, e ognuna legge ogni
 * documento una volta per apertura della pagina.
 */
const LETTURE_AL_MINUTO = 300;

export const GET = withErrorHandling(async (request, context) => {
  const { param } = (await context.params) as { param: string };

  const query = recordingSlidesFileQuerySchema.safeParse({
    m: new URL(request.url).searchParams.get('m') ?? undefined,
  });
  if (!query.success) throw new NotFoundError('Slides');

  const event = await prisma.event.findFirst({
    where: eventParamWhere(param),
    select: {
      id: true,
      slug: true,
      status: true,
      eventType: true,
      endsAt: true,
      postEventPublic: true,
      postEventPublicUntil: true,
      recordingUrl: true,
      recordingPublished: true,
      postEventShowMaterials: true,
    },
  });
  if (!event || !isEventPageVisible(event)) throw new NotFoundError('Event');

  const rl = rateLimit(`recording-slides-file:${event.id}:${getClientIp(request)}`, {
    limit: LETTURE_AL_MINUTO,
    windowMs: 60_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  // Le stesse regole della pagina, ricalcolate qui: solo una slide mostrata
  // accanto al video, con il file di un materiale dell'evento.
  const chiave = await publicSlideFileKey(event, query.data.m);
  if (!chiave) throw new NotFoundError('Slides');

  return streamMaterialPdf(chiave, 'recording/slides');
});
