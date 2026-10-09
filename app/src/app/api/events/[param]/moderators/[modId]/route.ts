/**
 * Revoke (soft-delete) or hard-delete a co-moderator entry, or update the
 * person's public profile.
 *
 *   PATCH  — ente, logo, organizzatore, presenza nella pagina pubblica
 *            (lib/events/grant-profile). Nome, email e ruolo non cambiano:
 *            si revoca e si aggiunge di nuovo, perché il link è della persona.
 *
 *   DELETE — sets `revokedAt` so the token stops being accepted. We
 *            don't hard-delete the row so the event management page
 *            can keep showing who previously had access. A real
 *            deletion happens via the cron cleanup once the retention
 *            window elapses.
 */

import { EventModeratorRole } from '@prisma/client';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { grantProfileData, grantProfileSchema } from '@/lib/events/grant-profile';
import { requireOrganizerMarkRight } from '@/lib/auth/organizer-mark';
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
  const updated = await prisma.eventModerator.update({
    where: { id: mod.id },
    data: {
      ...grantProfileData(parsed.data),
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
    },
  });
  return Response.json({ ...updated, name: tryDecryptPII(updated.name) ?? updated.name });
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
