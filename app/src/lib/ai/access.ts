/**
 * Access gating per gli endpoint pubblici di consumo postprod
 * (transcript JSON, subtitle VTT, dubbed audio).
 *
 * Tre cancelli, in ordine:
 *   1. kill-switch globale `SiteSetting.aiPipelineEnabled` → 404 se off
 *      (uniforme con la status card che torna `null`).
 *   2. evento esiste e `recordingPublished=true`.
 *   3. periodo "post-event pubblico" valido: `postEventPublic=true`
 *      e (se settato) `postEventPublicUntil` futuro.
 *
 * In tutti i casi di rifiuto torna 404 — non vogliamo distinguere
 * "evento non esiste" da "trascrizione ritirata", per non leakare
 * informazioni operative.
 */
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

export interface PostprodAccessOk {
  eventId: string;
}

export async function assertPostprodAccessible(slug: string): Promise<PostprodAccessOk> {
  const [site, event] = await Promise.all([
    prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { aiPipelineEnabled: true },
    }),
    prisma.event.findUnique({
      where: { slug },
      select: {
        id: true,
        recordingPublished: true,
        postEventPublic: true,
        postEventPublicUntil: true,
      },
    }),
  ]);

  if (!site?.aiPipelineEnabled) throw new NotFoundError('Postprod');
  if (!event) throw new NotFoundError('Event');
  if (!event.recordingPublished) throw new NotFoundError('Postprod');
  if (!event.postEventPublic) throw new NotFoundError('Postprod');
  if (event.postEventPublicUntil && event.postEventPublicUntil < new Date()) {
    throw new NotFoundError('Postprod');
  }

  return { eventId: event.id };
}
