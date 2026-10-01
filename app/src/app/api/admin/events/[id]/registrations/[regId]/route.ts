/**
 * PATCH  /api/admin/events/:id/registrations/:regId — rettifica (art. 16)
 * DELETE /api/admin/events/:id/registrations/:regId — cancellazione (art. 17)
 *
 * Per le richieste dell'interessato che arrivano allo staff per altre vie
 * (email, telefono, una persona che non riceve piu' la posta di quell'indirizzo):
 * prima servivano l'accesso al database. Chi gestisce l'evento corregge nome,
 * email e dati dell'ente, o cancella l'iscrizione a questo evento con i suoi
 * contributi (lib/gdpr/erase-registrations). La voce di rubrica e gli inviti
 * legati all'indirizzo non sono di un evento: restano, e si cancellano dalla
 * rubrica o con la richiesta da "I miei dati".
 *
 * La voce di rubrica collegata e' condivisa fra eventi e ha per chiave l'hash
 * dell'email, quindi:
 *   - nome ed ente corretti la raggiungono solo se corregge l'amministrazione,
 *     che la rubrica la gestisce; la correzione di chi organizza resta
 *     sull'iscrizione;
 *   - l'email di un'iscrizione collegata non si cambia qui: la voce resterebbe
 *     sotto l'indirizzo vecchio, con i suoi inviti e i link di uscita dalla
 *     rubrica gia' spediti. L'amministrazione toglie prima la voce dalla rubrica
 *     (l'iscrizione si stacca da sola), poi si corregge l'email.
 * Le email ancora in coda per l'iscrizione partono verso l'indirizzo nuovo.
 * Una che l'invio ha gia' preso in carico in quel momento arriva al vecchio.
 *
 * Nel registro delle azioni privilegiate restano solo identificativi e nomi dei
 * campi cambiati, mai i valori.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { requireEventManager } from '@/lib/auth/staff-session';
import { encryptPII, hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, ValidationError } from '@/lib/errors';
import { eraseRegistrations } from '@/lib/gdpr/erase-registrations';
import { ORGANIZATION_TYPES } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z
  .object({
    displayName: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    organization: z.string().trim().max(200).nullable().optional(),
    organizationRole: z.string().trim().max(200).nullable().optional(),
    organizationType: z.enum(ORGANIZATION_TYPES).nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'Nothing to change',
  });

type Ctx = { params: Promise<{ id: string; regId: string }> };

async function iscrizione(context: unknown) {
  const { id, regId } = await (context as Ctx).params;
  const session = await requireEventManager(await cookies(), id);
  if (!UUID_RE.test(regId)) throw new AppError('regId must be a UUID', 400, 'BAD_REQUEST');
  const reg = await prisma.registration.findUnique({
    where: { id: regId },
    select: { id: true, eventId: true, emailHash: true, personId: true },
  });
  // Un'iscrizione di un altro evento risponde come una che non c'e'.
  if (!reg || reg.eventId !== id) throw new NotFoundError('Registration');
  return { reg, session };
}

export const PATCH = withErrorHandling(async (request, context) => {
  const { reg, session } = await iscrizione(context);
  const parsed = patchSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const b = parsed.data;

  const nuovoHash = b.email !== undefined ? hashEmail(b.email) : null;
  const cambiaEmail = nuovoHash !== null && nuovoHash !== reg.emailHash;
  if (cambiaEmail && reg.personId) {
    throw new AppError(
      'The registration is linked to an address-book entry: remove the entry first',
      409,
      'ADDRESS_BOOK_LINKED',
    );
  }

  const data: Record<string, unknown> = {};
  const profilo: Record<string, unknown> = {};
  if (b.displayName !== undefined) {
    data.displayName = encryptPII(b.displayName);
    profilo.displayName = data.displayName;
  }
  if (b.organization !== undefined) profilo.organization = data.organization = b.organization || null;
  if (b.organizationRole !== undefined) {
    profilo.organizationRole = data.organizationRole = b.organizationRole || null;
  }
  if (b.organizationType !== undefined) profilo.organizationType = data.organizationType = b.organizationType;

  const aggiornaRubrica =
    session.role === 'admin' && reg.personId !== null && Object.keys(profilo).length > 0;

  const emailInCoda = await prisma.$transaction(async (tx) => {
    if (cambiaEmail) {
      // Un evento non ammette due iscrizioni con la stessa email.
      const altra = await tx.registration.findFirst({
        where: { eventId: reg.eventId, emailHash: nuovoHash, NOT: { id: reg.id } },
        select: { id: true },
      });
      if (altra) throw new AppError('Email already registered', 409, 'ALREADY_REGISTERED');
      data.email = encryptPII(b.email!);
      data.emailHash = nuovoHash;
    }

    await tx.registration.update({ where: { id: reg.id }, data });
    if (aggiornaRubrica) {
      await tx.person.update({ where: { id: reg.personId! }, data: profilo });
    }

    if (!cambiaEmail) return 0;
    const r = await tx.emailOutbox.updateMany({
      where: { status: 'PENDING', metadata: { path: ['registrationId'], equals: reg.id } },
      data: { toAddress: encryptPII(b.email!) },
    });
    return r.count;
  });

  await logAdminAction({
    request,
    action: 'REGISTRATION_RECTIFY',
    target: reg.id,
    details: {
      eventId: reg.eventId,
      fields: Object.keys(b).filter((k) => b[k as keyof typeof b] !== undefined),
      addressBookUpdated: aggiornaRubrica,
      queuedEmailsReaddressed: emailInCoda,
    },
  });

  return Response.json({ ok: true });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { reg } = await iscrizione(context);
  const counts = await eraseRegistrations([reg.id], 'admin/registration-delete');

  await prisma.gdprAuditLog.create({
    data: {
      eventId: reg.eventId,
      action: 'DATA_DELETED',
      recordCount: counts.registrations,
      details: JSON.stringify({ source: 'admin-registration-delete', ...counts }),
    },
  });
  await logAdminAction({
    request,
    action: 'REGISTRATION_DELETE',
    target: reg.id,
    details: { eventId: reg.eventId },
  });

  return Response.json({ ok: true, ...counts });
});
