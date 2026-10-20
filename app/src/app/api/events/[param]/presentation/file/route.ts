/**
 * GET /api/events/[param]/presentation/file?m=<materialId> — i byte del PDF
 * presentato nella sala, per il visore della sala (pdf.js).
 *
 * CHI. Chi sta nella stanza, con la regola dei pannelli
 * (lib/events/panel-read-access): lo stesso controllo dello stato della
 * presentazione. Il token di sala viaggia come `Authorization: Bearer`; un
 * ospite non ne ha, e per un evento protetto da password vale il cookie della
 * password.
 *
 * COSA. Solo il materiale presentato in questo momento: `m` deve essere
 * quello della riga. Chiusa la presentazione, passati a un altro documento o
 * concluso l'evento, la stessa richiesta risponde 404. Un materiale che la sua fase tiene fuori
 * dall'elenco pubblico non riceve così un indirizzo pubblico: la sala lo vede
 * finché è presentato, come con una condivisione dello schermo.
 *
 * COME. Lato server, come `/api/assets`: il browser non raggiunge lo storage
 * (nessun host in più nella CSP), il file si legge con un URL firmato breve
 * che non esce da qui. La chiave deve essere quella di un materiale
 * dell'evento (lib/events/material-files), mai un altro blob.
 *
 * CACHE. Privata e senza memoria: la risposta dipende da chi chiede e da cosa
 * si presenta adesso. Il visore tiene il documento aperto in memoria, quindi
 * lo scarica una volta per presentazione.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, RateLimitError } from '@/lib/errors';
import { eventParamWhere } from '@/lib/events/event-param';
import {
  PANEL_READ_EVENT_SELECT,
  authorizePanelRead,
} from '@/lib/events/panel-read-access';
import {
  PRESENTABLE_MATERIAL_SELECT,
  isPresentableMaterial,
  isPresentationOpen,
} from '@/lib/presentation/state';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { getFilesStorage } from '@/lib/storage';
import { presentationFileQuerySchema } from '@/lib/validation/presentation';

export const dynamic = 'force-dynamic';

/**
 * Letture per indirizzo e minuto. Alto di proposito: dietro la rete di un
 * ufficio decine di persone escono con lo stesso indirizzo, e ognuna scarica
 * il documento una volta per presentazione.
 */
const LETTURE_AL_MINUTO = 600;

export const GET = withErrorHandling(async (request, context) => {
  const { param } = (await context.params) as { param: string };

  const query = presentationFileQuerySchema.safeParse({
    m: new URL(request.url).searchParams.get('m') ?? undefined,
  });
  if (!query.success) throw new NotFoundError('Presentation');

  const event = await prisma.event.findFirst({
    where: eventParamWhere(param),
    select: PANEL_READ_EVENT_SELECT,
  });
  if (!event) throw new NotFoundError('Event');
  await authorizePanelRead(event, extractModeratorToken(request));
  // Concluso l'evento, la presentazione rimasta aperta non si serve più.
  if (!isPresentationOpen(event.status)) throw new NotFoundError('Presentation');

  const rl = rateLimit(`presentation-file:${event.id}:${getClientIp(request)}`, {
    limit: LETTURE_AL_MINUTO,
    windowMs: 60_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const row = await prisma.eventPresentation.findUnique({
    where: { eventId: event.id },
    select: { materialId: true, material: { select: PRESENTABLE_MATERIAL_SELECT } },
  });
  const material = row?.material;
  if (!row || row.materialId !== query.data.m || !material)
    throw new NotFoundError('Presentation');
  if (!isPresentableMaterial(material, event.id)) throw new NotFoundError('Presentation');

  const storage = getFilesStorage();
  if (!storage) {
    const err = new AppError(
      'Files storage is not configured',
      503,
      'STORAGE_UNAVAILABLE'
    );
    err.expected = true;
    throw err;
  }

  let upstream: Response;
  try {
    const firmato = await storage.getDownloadUrl(material.blobPath, {
      expiresInMinutes: 10,
    });
    upstream = await fetch(firmato);
  } catch (err) {
    console.error(
      '[presentation/file] lettura dallo storage non riuscita:',
      err instanceof Error ? err.message : err
    );
    throw new AppError(
      'Failed to read the file from storage',
      502,
      'STORAGE_READ_FAILED'
    );
  }
  if (!upstream.ok || !upstream.body) throw new NotFoundError('Presentation');

  const headers = new Headers({
    // Il tipo lo decide il materiale (un PDF verificato al caricamento), non
    // lo storage; e non lo indovina il browser.
    'Content-Type': 'application/pdf',
    'X-Content-Type-Options': 'nosniff',
    // Lo legge il visore della sala; aperto direttamente si scarica.
    'Content-Disposition': 'attachment',
    'Cache-Control': 'private, no-store',
  });
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);

  return new Response(upstream.body, { status: 200, headers });
});
