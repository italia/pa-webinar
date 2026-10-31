/**
 * Manda l'invito per email agli invitati dell'evento.
 *
 *   POST { ids?: string[] } — gli invitati indicati (anche di nuovo), oppure,
 *        senza `ids`, quelli non ancora invitati (al massimo
 *        INVITI_PER_RICHIESTA per volta). Chi si e' gia' iscritto non riceve
 *        l'invito. Risponde { sent, skipped, remaining }.
 *
 * Di chi gestisce l'evento (ADR-014). Solo mentre l'evento accetta iscrizioni
 * (la pagina a cui porta l'invito): 409 EVENT_NOT_SENDABLE altrimenti. Un
 * secondo invio uguale nello stesso momento non manda una seconda email
 * (lib/email/invitation).
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { requireEventManager } from '@/lib/auth/staff-session';
import { InvitiNonInviabili, sendInvitations } from '@/lib/email/invitation';
import { adminRequestLocale } from '@/lib/email/moderator-link';
import { AppError, RateLimitError, ValidationError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(500).optional(),
  })
  .strict();

export const POST = withErrorHandling(async (request, context) => {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  await requireEventManager(await cookies(), id);

  const parsed = bodySchema.safeParse((await parseJsonBody(request)) ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  // Un tetto contro i cicli, non contro il doppio clic (a quello pensa la
  // coda): chi manda gli inviti uno per uno non ci arriva.
  const rl = rateLimit(`invitations-send:${id}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  try {
    const esito = await sendInvitations(id, {
      ids: parsed.data.ids,
      locale: adminRequestLocale(request, (await getSettings()).defaultLocale),
    });
    if (!esito) throw new AppError('Event not found', 404, 'NOT_FOUND');
    await logAdminAction({
      request,
      action: 'EVENT_INVITATION_SEND',
      target: id,
      details: { sent: esito.sent, skipped: esito.skipped, remaining: esito.remaining },
    });
    return Response.json(esito);
  } catch (err) {
    if (err instanceof InvitiNonInviabili) {
      throw new AppError(err.message, 409, 'EVENT_NOT_SENDABLE');
    }
    throw err;
  }
});
