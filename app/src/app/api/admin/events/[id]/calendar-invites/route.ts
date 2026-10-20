/**
 * /api/admin/events/[id]/calendar-invites — reinvio dell'invito di
 * calendario a tutte le persone dell'evento (lib/email/calendar-invite).
 *
 *   GET  — prova a vuoto: quante persone lo riceverebbero, nessun invio.
 *   POST — accoda le email. Il corpo deve ripetere lo slug dell'evento
 *          (`{ "confirm": "<slug>" }`): un invio a centinaia di persone non
 *          parte per un clic sbagliato o un identificativo scambiato.
 *
 * Solo l'amministrazione dell'istanza. Ripetere il POST non rispedisce:
 * ogni persona riceve l'invito una volta per orario dell'evento.
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { requireAdmin } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import {
  canSendCalendarInvites,
  countCalendarInviteRecipients,
  sendCalendarInvites,
} from '@/lib/email/calendar-invite';
import { adminRequestLocale } from '@/lib/email/moderator-link';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sendSchema = z.object({ confirm: z.string().min(1).max(300) });

async function loadEvent(id: string) {
  if (!UUID_RE.test(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, slug: true, status: true, endsAt: true },
  });
  if (!event) throw new NotFoundError('Event');
  return event;
}

export const GET = withErrorHandling(async (_request, context) => {
  await requireAdmin(await cookies());
  const { id } = await context.params;
  const event = await loadEvent(id);
  return Response.json(
    {
      dryRun: true,
      sendable: canSendCalendarInvites(event),
      recipients: await countCalendarInviteRecipients(event.id),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});

export const POST = withErrorHandling(async (request, context) => {
  await requireAdmin(await cookies());
  const { id } = await context.params;
  const event = await loadEvent(id);

  const parsed = sendSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }
  if (parsed.data.confirm !== event.slug) {
    throw new ValidationError('Confirmation does not match the event slug', [
      { path: ['confirm'], message: 'must equal the event slug' },
    ]);
  }
  if (!canSendCalendarInvites(event)) {
    throw new ConflictError(
      'Calendar invitations are sent only for published events that have not ended'
    );
  }

  // Prima dell'invio: anche un invio interrotto a meta' (timeout, riavvio)
  // resta nel registro. L'esito e' nella risposta.
  await logAdminAction({
    request,
    action: 'EVENT_CALENDAR_INVITES_SEND',
    target: event.id,
  });

  const settings = await getSettings();
  const result = await sendCalendarInvites(event.id, {
    staffLocale: adminRequestLocale(request, settings.defaultLocale),
  });
  if (!result) throw new NotFoundError('Event');

  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
});
