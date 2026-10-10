/**
 * GET  /api/admin/events/[id]/captions-transcript — a che punto e' la
 *      trascrizione dai sottotitoli: frasi salvate e non, voci, trascrizione
 *      costruita (da dove viene, se e' stata corretta), se e' pubblicata.
 * POST /api/admin/events/[id]/captions-transcript
 *
 * Il POST costruisce (o ricostruisce) la trascrizione dell'evento dai sottotitoli
 * live (lib/captions/transcript): la fa anche il giro periodico dopo la fine
 * dell'evento, qui la chiede lo staff, per esempio dopo aver aspettato le
 * ultime frasi. Non tocca una trascrizione AI ne' una corretta a mano.
 *
 * Di chi gestisce l'evento: l'admin, chi l'ha creato o un altro organizzatore.
 */
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireEventManager } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import {
  CAPTIONS_TRANSCRIPT_MODEL,
  contaVoci,
  costruisciTrascrizioneDaiSottotitoli,
} from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (_request, context) => {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  await requireEventManager(await cookies(), id);

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, transcriptPublished: true, recordingPublished: true, recordingUrl: true },
  });
  if (!event) throw new NotFoundError('Event');

  const [frasi, segnaposto, voci, registrazione] = await Promise.all([
    prisma.captionSegment.count({ where: { eventId: id, text: { not: null } } }),
    prisma.captionSegment.count({ where: { eventId: id, text: null } }),
    prisma.captionSegment.findMany({
      where: { eventId: id, text: { not: null } },
      // Un nome per posto: il nome e' cifrato, quindi distinto per riga.
      distinct: ['seatId'],
      select: { seatId: true, speakerName: true },
    }),
    prisma.recording.findFirst({
      where: { eventId: id, artifacts: { some: { type: 'TRANSCRIPT_JSON', language: null } } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        artifacts: {
          where: { type: 'TRANSCRIPT_JSON', language: null },
          select: { modelId: true, revisedAt: true },
          take: 1,
        },
      },
    }),
  ]);
  const artefatto = registrazione?.artifacts[0];

  return Response.json({
    frasi,
    // Le frasi di chi non ha dato il consenso: contate, senza testo ne' nome.
    segnaposto,
    // Le persone, non i posti: chi si ricollega ha un posto nuovo.
    voci: contaVoci(voci),
    trascrizione:
      registrazione && artefatto
        ? {
            recordingId: registrazione.id,
            origine: artefatto.modelId === CAPTIONS_TRANSCRIPT_MODEL ? 'sottotitoli' : 'ai',
            corretta: artefatto.revisedAt !== null,
          }
        : null,
    pubblicata: event.transcriptPublished,
    videoPubblicato: event.recordingPublished && !!event.recordingUrl,
  });
});

export const POST = withErrorHandling(async (request, context) => {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  await requireEventManager(await cookies(), id);

  const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) throw new NotFoundError('Event');

  const esito = await costruisciTrascrizioneDaiSottotitoli(id);
  await logAdminAction({
    request,
    action: 'CAPTIONS_TRANSCRIPT_BUILT',
    target: id,
    details: { stato: esito.stato, ...(esito.stato === 'scritta' ? { segmenti: esito.segmenti } : {}) },
  });
  return Response.json(esito);
});
