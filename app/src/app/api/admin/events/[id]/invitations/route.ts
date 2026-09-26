/**
 * Admin: event invitations (pre-registration list).
 *
 *   GET  — list invitations for the event (includes linked Person if any)
 *   POST — add an invitation (by email; optional personId to link rubrica)
 *
 * Auth: admin session cookie.
 *
 * Tokens for the registration magic link are *not* generated here —
 * they're minted at send-time by a separate endpoint so staging an
 * invitation doesn't commit to emailing it yet.
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { requireEventManager } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { encryptPII, encryptPIIOrNull, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const addSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(200).optional(),
  role: z.enum(['GUEST', 'SPEAKER']).default('GUEST'),
  personId: z.string().uuid().nullable().optional(),
});

async function loadEvent(id: string) {
  if (!UUID_RE.test(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');
  return event;
}

export const GET = withErrorHandling(async (_request, context) => {
  const { id } = await context.params;
  // Dell'evento: l'admin, o l'organizzatore che l'ha creato (ADR-014).
  const session = await requireEventManager(await cookies(), id);
  // La rubrica e' dell'amministrazione (ADR-014): l'organizzatore vede e
  // scrive l'invito, non il profilo della persona collegata.
  const conRubrica = session.role === 'admin';
  const event = await loadEvent(id);

  const rows = await prisma.eventInvitation.findMany({
    where: { eventId: event.id },
    include: {
      person: {
        select: { id: true, displayName: true, organization: true, organizationRole: true },
      },
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });

  return Response.json({
    rows: rows.map((r) => ({
      ...r,
      name: tryDecryptPII(r.name),
      email: tryDecryptPII(r.email),
      // Person.displayName is encrypted at rest; decrypt for the response
      // so the rubrica-linked invitation row shows a readable name.
      person: conRubrica && r.person
        ? { ...r.person, displayName: tryDecryptPII(r.person.displayName) }
        : null,
    })),
  });
});

export const POST = withErrorHandling(async (request, context) => {
  const { id } = await context.params;
  // Dell'evento: l'admin, o l'organizzatore che l'ha creato (ADR-014).
  const session = await requireEventManager(await cookies(), id);
  // La rubrica e' dell'amministrazione (ADR-014): l'organizzatore vede e
  // scrive l'invito, non il profilo della persona collegata.
  const conRubrica = session.role === 'admin';
  const event = await loadEvent(id);

  const body = await parseJsonBody(request);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  if (!conRubrica && parsed.data.personId) throw new ForbiddenError();

  // Normalize the email for the deterministic hash. The plaintext is
  // never stored — only its encryption and its HMAC fingerprint.
  const emailNorm = parsed.data.email.trim().toLowerCase();
  const emailHash = hashEmail(emailNorm);

  try {
    const created = await prisma.eventInvitation.create({
      data: {
        eventId: event.id,
        email: encryptPII(emailNorm),
        emailHash,
        name: encryptPIIOrNull(parsed.data.name),
        role: parsed.data.role,
        personId: parsed.data.personId ?? null,
      },
      include: {
        person: {
          select: { id: true, displayName: true, organization: true, organizationRole: true },
        },
      },
    });

    await logAdminAction({
      request,
      action: 'EVENT_INVITATION_CREATE',
      target: created.id,
      details: { eventId: event.id, role: created.role },
    });

    return Response.json(
      {
        ...created,
        name: tryDecryptPII(created.name),
        email: emailNorm,
        person: conRubrica && created.person
          ? { ...created.person, displayName: tryDecryptPII(created.person.displayName) }
          : null,
      },
      { status: 201 },
    );
  } catch (e: unknown) {
    if (typeof e === 'object' && e && 'code' in e && (e as { code: string }).code === 'P2002') {
      throw new AppError('This email is already invited to the event', 409, 'CONFLICT');
    }
    throw e;
  }
});
