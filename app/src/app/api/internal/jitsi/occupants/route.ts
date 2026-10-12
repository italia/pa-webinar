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
 *
 * A un ingresso, dove il servizio dei sottotitoli e' installato, la risposta
 * dice se l'evento li vuole adesso (`{ captions: boolean }`): Prosody
 * (mod_pa_captions) accende o spegne la trascrizione della stanza da solo,
 * anche senza un moderatore in sala.
 */
import { z } from 'zod';

import { JSON_BODY_MAX_BYTES, readBodyBytes, withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { verificaFirmaProsody } from '@/lib/auth/prosody-signature';
import { captionsInstalled, liveCaptionsAvailable } from '@/lib/captions/availability';
import { eventoDellaStanza } from '@/lib/captions/room';
import { prisma } from '@/lib/db';
import { isRecorderSeat } from '@/lib/recorder/seat';
import { getSettings } from '@/lib/settings';
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const comuni = {
  room: z.string().min(1).max(200),
  meetingId: z.string().min(1).max(64).optional(),
  /** Ora di invio in secondi: la firma di Prosody la copre. */
  ts: z.number().int().optional(),
};

const occupanteSchema = z.discriminatedUnion('action', [
  z.object({
    ...comuni,
    endpointId: z.string().min(1).max(64),
    seatId: z.string().min(1).max(80),
    action: z.enum(['joined', 'left']),
  }),
  // Ogni trenta secondi, per una stanza con qualcuno dentro: solo la domanda
  // sui sottotitoli, senza nessuno da registrare.
  z.object({ ...comuni, action: z.literal('check') }),
]);

/**
 * Se l'evento vuole adesso i sottotitoli nella stanza, per Prosody, che la
 * usa solo nelle stanze senza un moderatore, dove nessuna sala applica
 * l'interruttore. Spenti, per l'istanza o per l'evento, vale sempre
 * «spegni»: una stanza accesa prima va spenta anche senza un moderatore.
 * «Accendi» solo con l'evento in diretta: il servizio, che lo scaler accende
 * durante la preparazione, a quel punto ha caricato il modello; prima non si
 * decide niente (null).
 */
function decisione(
  event: { status: string; liveCaptionsEnabled: boolean | null },
  sottotitoli: boolean,
): boolean | null {
  if (!sottotitoli || event.liveCaptionsEnabled === false) return false;
  return event.status === 'LIVE' ? true : null;
}

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
  const dati = parsed.data;
  // Alla domanda periodica, 404 dove non serve (servizio dei sottotitoli non
  // installato, stanza che non e' di un evento): Prosody smette di chiedere
  // per quella stanza.
  if (dati.action === 'check' && !captionsInstalled()) return new Response(null, { status: 404 });
  const event = await eventoDellaStanza(dati.room);
  if (!event) return new Response(null, { status: dati.action === 'check' ? 404 : 204 });
  const sottotitoli = liveCaptionsAvailable(await getSettings());
  // Chi e' chi serve solo dove la voce passa per il servizio dei sottotitoli
  // o per il registratore multitraccia: per tenerla solo di chi ha
  // acconsentito (anche se la trascrizione si accende a evento iniziato), e
  // per legare la conferenza all'evento dall'id della riunione
  // (lib/captions/room). Altrimenti non si salva niente.
  // I sottotitoli contano dove il servizio c'e' ed e' acceso per l'istanza
  // (lib/captions/availability), qualunque sia il flag dell'evento: si puo'
  // accendere a evento iniziato, e chi e' gia' in sala deve essere
  // riconosciuto.
  if (dati.action !== 'check' && (sottotitoli || event.multitrackRecordingEnabled)) {
    const { endpointId, seatId, meetingId } = dati;
    const adesso = new Date();
    if (dati.action === 'joined') {
      await prisma.roomOccupant.upsert({
        where: { eventId_endpointId: { eventId: event.id, endpointId } },
        create: {
          eventId: event.id,
          endpointId,
          seatId,
          meetingId: meetingId ?? null,
          joinedAt: adesso,
        },
        update: { seatId, meetingId: meetingId ?? null, joinedAt: adesso, leftAt: null },
      });
    } else {
      await prisma.roomOccupant.updateMany({
        where: { eventId: event.id, endpointId, leftAt: null },
        data: { leftAt: adesso },
      });
    }
  }
  // A un ingresso e alla domanda periodica, dove il servizio c'e'. Il
  // registratore non conta: da solo in una stanza non c'e' nessuno da
  // sottotitolare.
  const chiede =
    dati.action === 'check' || (dati.action === 'joined' && !isRecorderSeat(dati.seatId));
  if (chiede && captionsInstalled()) {
    const captions = decisione(event, sottotitoli);
    if (captions !== null) return Response.json({ captions });
  }
  return new Response(null, { status: 204 });
});
