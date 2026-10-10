/**
 * GET /api/internal/recorder/consent?eventId=<id>&endpoint=<endpoint del bridge>
 *
 * Se il registratore multitraccia puo' registrare la voce di quell'endpoint:
 * solo se la persona dietro (il posto della conferenza, da Prosody) ha dato
 * il consenso alla trascrizione dei propri interventi. Chi non e' riconosciuto
 * non si registra: la risposta lo dice (`reason: 'unknown'`), perche' il
 * registratore lo segnali nel log — se nessuno e' riconosciuto, Prosody non
 * sta mandando gli occupanti (mod_pa_occupants).
 *
 * Auth: CRON_API_KEY (header x-api-key), come gli altri endpoint /internal.
 */
import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { consensoTrascrizione, postoDellEndpoint } from '@/lib/captions/room';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId') ?? '';
  const endpoint = url.searchParams.get('endpoint')?.trim() ?? '';
  if (!UUID_RE.test(eventId) || !endpoint || endpoint.length > 64) {
    throw new AppError('eventId and endpoint are required', 400, 'BAD_REQUEST');
  }
  const seatId = await postoDellEndpoint(eventId, endpoint);
  if (!seatId) return Response.json({ record: false, reason: 'unknown' });
  const { dato } = await consensoTrascrizione(eventId, seatId, 1);
  return Response.json({ record: dato });
});
