/**
 * POST /api/internal/jitsi/occupants
 *
 * Chi entra ed esce dalla conferenza, come lo vede Prosody (mod_pa_occupants):
 * stanza, endpoint del bridge e posto del token (`context.user.id`). Il portale
 * tiene la corrispondenza per sapere, voce per voce, se la persona ha dato il
 * consenso alla trascrizione dei propri interventi (lib/captions/room).
 *
 * Auth: la firma di Prosody (header x-pa-signature, lib/auth/prosody-signature,
 * con il segreto dei token della conferenza), oppure CRON_API_KEY (header
 * x-api-key) come gli altri endpoint /internal.
 * Una stanza che non e' di un evento si ignora (204): la chiamata rapida,
 * una stanza di prova.
 */
import { z } from 'zod';

import { JSON_BODY_MAX_BYTES, readBodyBytes, withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { verificaFirmaProsody } from '@/lib/auth/prosody-signature';
import { liveCaptionsAvailable } from '@/lib/captions/availability';
import { eventoDellaStanza } from '@/lib/captions/room';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const occupanteSchema = z.object({
  room: z.string().min(1).max(200),
  meetingId: z.string().min(1).max(64).optional(),
  endpointId: z.string().min(1).max(64),
  seatId: z.string().min(1).max(80),
  action: z.enum(['joined', 'left']),
  /** Ora di invio in secondi: la firma di Prosody la copre. */
  ts: z.number().int().optional(),
});

export const POST = withErrorHandling(async (request) => {
  const corpo = new TextDecoder().decode(await readBodyBytes(request, JSON_BODY_MAX_BYTES));
  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    throw new AppError('Invalid JSON body', 400, 'INVALID_BODY');
  }
  const firma = request.headers.get('x-pa-signature');
  if (firma !== null) {
    const ts = (json as { ts?: unknown } | null)?.ts;
    if (!verificaFirmaProsody(corpo, firma, typeof ts === 'number' ? ts : undefined)) {
      throw new UnauthorizedError();
    }
  } else {
    assertCronApiKey(request);
  }
  const parsed = occupanteSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const { room, meetingId, endpointId, seatId, action } = parsed.data;
  const event = await eventoDellaStanza(room);
  if (!event) return new Response(null, { status: 204 });
  // Chi e' chi serve solo dove la voce passa per il servizio dei sottotitoli
  // o per il registratore multitraccia: per tenerla solo di chi ha
  // acconsentito (anche se la trascrizione si accende a evento iniziato), e
  // per legare la conferenza all'evento dall'id della riunione
  // (lib/captions/room). Altrimenti non si salva niente.
  // I sottotitoli contano dove il servizio c'e' ed e' acceso per l'istanza
  // (lib/captions/availability), qualunque sia il flag dell'evento: si puo'
  // accendere a evento iniziato, e chi e' gia' in sala deve essere
  // riconosciuto.
  if (!liveCaptionsAvailable(await getSettings()) && !event.multitrackRecordingEnabled) {
    return new Response(null, { status: 204 });
  }

  const adesso = new Date();
  if (action === 'joined') {
    await prisma.roomOccupant.upsert({
      where: { eventId_endpointId: { eventId: event.id, endpointId } },
      create: { eventId: event.id, endpointId, seatId, meetingId: meetingId ?? null, joinedAt: adesso },
      update: { seatId, meetingId: meetingId ?? null, joinedAt: adesso, leftAt: null },
    });
  } else {
    await prisma.roomOccupant.updateMany({
      where: { eventId: event.id, endpointId, leftAt: null },
      data: { leftAt: adesso },
    });
  }
  return new Response(null, { status: 204 });
});
