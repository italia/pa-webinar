/**
 * POST /api/events/[param]/consents/withdraw
 *
 * Il ritiro dalla sala dei consensi dati per l'evento (art. 7.3 GDPR): la
 * trascrizione dei propri interventi e, con `recording`, la registrazione.
 * Chi ritira prova i propri posti con i token della sala che il portale gli
 * ha consegnato in questa visita della pagina (lib/auth/jwt
 * postoDaTokenSala): nessun altro dato, e nessun link personale da mandare.
 * Cosa cambia lo dice lib/live/consent-withdrawal. Dopo il ritiro la sala
 * chiede un token nuovo senza quei consensi (o esce, se senza consenso alla
 * registrazione non si puo' restare).
 */
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { postoDaTokenSala } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { ritiraConsensi } from '@/lib/live/consent-withdrawal';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { consentWithdrawalSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const ip = getClientIp(request);
  const rl = rateLimit(`consent-withdraw:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const parsed = consentWithdrawalSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, jitsiRoomName: true },
  });
  if (!event) throw new NotFoundError('Event');

  const prove = await Promise.all(
    parsed.data.roomTokens.map((t) =>
      postoDaTokenSala(t, event.jitsiRoomName, { ancheChiModera: true })
    )
  );
  const posti = [...new Set(prove.filter((p) => p !== null).map((p) => p.posto))];
  if (posti.length === 0) {
    throw new AppError('No valid room token for this event', 401, 'ROOM_TOKEN_INVALID');
  }

  const esito = await ritiraConsensi(event.id, posti, {
    registrazione: parsed.data.recording,
  });
  return Response.json(
    { withdrawn: { recording: esito.registrazione, transcription: esito.trascrizione } },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
