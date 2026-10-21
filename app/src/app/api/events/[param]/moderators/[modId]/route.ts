/**
 * Revoke (soft-delete) or hard-delete a co-moderator entry, or update the
 * person's public profile.
 *
 *   PATCH  — ente, logo, foto, organizzatore, presenza nella pagina
 *            pubblica (lib/events/grant-profile). Nome, email e ruolo non
 *            cambiano: si revoca e si aggiunge di nuovo, perché il link è
 *            della persona. Una foto che non c'è più si lascia cadere.
 *
 *   POST   — «Reinvia link»: rimette in coda l'email con il link personale
 *            (lib/email/moderator-link resendGrantModeratorLink). Non in
 *            bozza ne' a evento concluso o archiviato (i link non partono),
 *            non a una concessione revocata o senza indirizzo; al massimo tre
 *            email del link ogni dieci minuti per concessione.
 *
 *   DELETE — sets `revokedAt` so the token stops being accepted. We
 *            don't hard-delete the row so the event management page
 *            can keep showing who previously had access. A real
 *            deletion happens via the cron cleanup once the retention
 *            window elapses.
 */

import { EventModeratorRole } from '@prisma/client';
import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, RateLimitError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { NO_SEND_STATUSES, adminRequestLocale, resendGrantModeratorLink } from '@/lib/email/moderator-link';
import { getSettings } from '@/lib/settings';
import { hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { grantProfileData, grantProfileSchema } from '@/lib/events/grant-profile';
import { usablePersonPhotoId } from '@/lib/events/person-photo-store';
import { requireOrganizerMarkRight } from '@/lib/auth/organizer-mark';
import { isEventManager } from '@/lib/auth/staff-session';
import {
  constantTimeEqual,
  extractModeratorToken,
  invalidateModeratorCache,
} from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L'evento e la concessione, se chi chiama ha il link principale. */
async function caricaConcessione(request: Request, param: string, modId: string) {
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  if (!UUID_RE.test(modId)) {
    throw new AppError('modId must be a UUID', 400, 'BAD_REQUEST');
  }

  const where = UUID_RE.test(param)
    ? { id: param }
    : { slug: param };
  const event = await prisma.event.findUnique({ where });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');
  if (!constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Only the primary moderator can manage co-moderators');
  }

  const mod = await prisma.eventModerator.findUnique({ where: { id: modId } });
  if (!mod || mod.eventId !== event.id) {
    throw new AppError('Co-moderator not found', 404, 'NOT_FOUND');
  }
  return { event, mod };
}

export const PATCH = withErrorHandling(async (request, context) => {
  const { param, modId } = await context.params;
  const { mod } = await caricaConcessione(request, param, modId);

  const parsed = grantProfileSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  if (parsed.data.organizer && mod.role !== EventModeratorRole.MODERATOR) {
    throw new ValidationError('Validation failed', [
      { path: ['organizer'], message: 'Only a moderator can be an organizer' },
    ]);
  }
  // Togliere il segno si può con il link principale; darlo, solo a chi
  // gestisce già l'evento (lib/auth/organizer-mark). Lo stesso vale per
  // confermarlo su una concessione da organizzatore ancora senza impronta.
  const daIlSegno = parsed.data.organizer === true && (!mod.organizer || !mod.emailHash);
  if (daIlSegno) await requireOrganizerMarkRight(mod.eventId);

  // Le concessioni nate prima dell'impronta la ricevono qui, ma su una
  // concessione da organizzatore solo dopo il controllo: l'impronta è ciò che
  // dà la gestione all'account dello staff con lo stesso indirizzo.
  const saraOrganizzatore = parsed.data.organizer ?? mod.organizer;
  const puoImprontare = !saraOrganizzatore || daIlSegno;
  const email = mod.emailHash || !puoImprontare ? null : tryDecryptPII(mod.email);
  // Una foto che nessuno usa ancora la aggancia solo lo staff dell'evento:
  // con il solo link si tengono le foto che l'evento ha gia'.
  const photoId = await usablePersonPhotoId(
    parsed.data.photoId,
    mod.eventId,
    parsed.data.photoId && (await isEventManager(await cookies(), mod.eventId)) ? 'staff' : 'link',
  );
  const updated = await prisma.eventModerator.update({
    where: { id: mod.id },
    data: {
      ...grantProfileData({ ...parsed.data, photoId }),
      ...(email && { emailHash: hashEmail(email) }),
    },
    select: {
      id: true,
      name: true,
      role: true,
      organizer: true,
      organization: true,
      organizationLogoUrl: true,
      publicListed: true,
      photoId: true,
    },
  });
  return Response.json({ ...updated, name: tryDecryptPII(updated.name) ?? updated.name });
});

export const POST = withErrorHandling(async (request, context) => {
  const { param, modId } = await context.params;
  const { event, mod } = await caricaConcessione(request, param, modId);
  if (event.status === 'DRAFT') {
    throw new AppError('Links are sent when the event is published', 409, 'EVENT_DRAFT');
  }
  if (NO_SEND_STATUSES.has(event.status)) {
    throw new AppError('The event is over: links are no longer sent', 409, 'EVENT_ENDED');
  }
  if (mod.revokedAt) throw new AppError('The grant was revoked', 409, 'GRANT_REVOKED');
  if (!tryDecryptPII(mod.email)?.trim()) {
    throw new AppError('The grant has no email address', 422, 'GRANT_NO_EMAIL');
  }
  // Il limite conta le email del link gia' in coda (primo invio compreso),
  // nel database: vale per tutte le repliche, e un tentativo fallito non lo
  // consuma.
  const finestra = 10 * 60_000;
  const recenti = await prisma.emailOutbox.count({
    where: {
      createdAt: { gte: new Date(Date.now() - finestra) },
      metadata: { path: ['grantId'], equals: mod.id },
    },
  });
  if (recenti >= 3) throw new RateLimitError(finestra / 1000);

  const { defaultLocale: predefinita } = await getSettings();
  const inCoda = await resendGrantModeratorLink(mod.id, { locale: adminRequestLocale(request, predefinita) });
  if (!inCoda) throw new AppError('The email could not be queued', 500, 'NOT_QUEUED');
  return Response.json({ queued: true });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { param, modId } = await context.params;
  const { event, mod } = await caricaConcessione(request, param, modId);

  const updated = await prisma.eventModerator.update({
    where: { id: modId },
    data: { revokedAt: mod.revokedAt ?? new Date() },
  });

  // Le GET di polling (Q&A/sondaggi) cacheano l'esito moderatore per 5s:
  // senza questa invalidazione il token revocato resterebbe accettato lì
  // fino alla scadenza del TTL.
  invalidateModeratorCache(event.id, mod.token);

  return Response.json({ revoked: true, id: updated.id });
});
