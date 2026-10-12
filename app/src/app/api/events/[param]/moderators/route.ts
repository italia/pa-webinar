/**
 * Co-moderator management for an event.
 *
 *   GET   — list co-moderators (primary moderator only)
 *   POST  — add a new co-moderator; returns the generated token so the
 *           UI can surface the magic link to the primary moderator.
 *
 * Authentication: the caller must hold the primary `moderatorToken`
 * for the event (verified via verifyModeratorToken — which also now
 * accepts co-moderator tokens, so we additionally require the token
 * to be the primary one for these management actions).
 */

import { randomUUID } from 'crypto';

import { EventModeratorRole } from '@prisma/client';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, RateLimitError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { encryptPII, encryptPIIOrNull, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { adminRequestLocale, sendGrantModeratorLink } from '@/lib/email/moderator-link';
import { getSettings } from '@/lib/settings';
import { grantProfileData, grantProfileSchema } from '@/lib/events/grant-profile';
import { requireOrganizerMarkRight } from '@/lib/auth/organizer-mark';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const addModeratorSchema = z
  .object({
    name: z.string().min(2).max(100),
    email: z.string().email().optional(),
    role: z.nativeEnum(EventModeratorRole).optional(),
  })
  .merge(grantProfileSchema)
  .refine((d) => !d.organizer || (d.role ?? EventModeratorRole.MODERATOR) === EventModeratorRole.MODERATOR, {
    message: 'Only a moderator can be an organizer',
    path: ['organizer'],
  });

async function requirePrimary(eventIdOrSlug: string, token: string) {
  const where = UUID_RE.test(eventIdOrSlug)
    ? { id: eventIdOrSlug }
    : { slug: eventIdOrSlug };
  const event = await prisma.event.findUnique({ where });
  if (!event) {
    throw new AppError('Event not found', 404, 'NOT_FOUND');
  }
  if (!constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Only the primary moderator can manage co-moderators');
  }
  return event;
}

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await requirePrimary(param, token);

  const rows = await prisma.eventModerator.findMany({
    where: { eventId: event.id },
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      organizer: true,
      organization: true,
      organizationLogoUrl: true,
      publicListed: true,
      token: true,
      createdAt: true,
      revokedAt: true,
    },
  });

  return Response.json({
    rows: rows.map((r) => ({
      ...r,
      name: tryDecryptPII(r.name) ?? r.name,
      email: tryDecryptPII(r.email),
    })),
  });
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await requirePrimary(param, token);

  const ip = getClientIp(request);
  const rl = rateLimit(`moderators-add:${ip}:${event.id}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = addModeratorSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  if (parsed.data.organizer) await requireOrganizerMarkRight(event.id);

  const created = await prisma.eventModerator.create({
    data: {
      eventId: event.id,
      name: encryptPII(parsed.data.name),
      email: encryptPIIOrNull(parsed.data.email),
      // L'impronta riconosce l'account dello staff con lo stesso indirizzo
      // (lib/auth/staff-session, eventScope).
      emailHash: parsed.data.email ? hashEmail(parsed.data.email) : null,
      role: parsed.data.role ?? EventModeratorRole.MODERATOR,
      ...grantProfileData(parsed.data),
      token: randomUUID(),
    },
  });

  // Il link personale per email, con il testo del ruolo (co-moderatore o
  // relatore). Su un evento in bozza non parte qui ma alla pubblicazione
  // (lib/email/moderator-link); in ogni caso una volta sola per concessione.
  if (parsed.data.email) {
    const { defaultLocale: predefinita } = await getSettings();
    await sendGrantModeratorLink(created.id, {
      locale: adminRequestLocale(request, predefinita),
    });
  }

  // L'impronta dell'indirizzo resta sul server: è l'identificativo che lega
  // la persona fra eventi, richieste GDPR e account dello staff.
  const { emailHash: _impronta, ...riga } = created;
  return Response.json(
    {
      ...riga,
      name: tryDecryptPII(created.name),
      email: tryDecryptPII(created.email),
    },
    { status: 201 },
  );
});
