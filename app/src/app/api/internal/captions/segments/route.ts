/**
 * POST /api/internal/captions/segments  (ADR-018)
 *
 * Le frasi definitive dei sottotitoli live, mandate dal servizio dei
 * sottotitoli per la trascrizione dell'evento (Event.captionsTranscriptEnabled).
 *
 * Il servizio conosce solo l'endpoint del bridge; qui l'endpoint diventa una
 * persona (il posto del token, da Prosody) e si guarda il suo consenso alla
 * trascrizione dei propri interventi. Con il consenso si tengono nome e testo,
 * cifrati; senza, resta solo che in quel momento qualcuno ha parlato. Una frase
 * gia' salvata (stesso id) non si raddoppia.
 *
 * Auth: CRON_API_KEY (header x-api-key), come gli altri endpoint /internal.
 */
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { consensoTrascrizione, eventoDellaConferenza, postoDellEndpoint, type ConsensoTrascrizione } from '@/lib/captions/room';
import { encryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { VERSIONE_TESTO_TRASCRIZIONE } from '@/lib/registration/consents';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const segmentoSchema = z.object({
  messageId: z.string().min(1).max(80),
  endpointId: z.string().min(1).max(64),
  text: z.string().min(1).max(2000),
  language: z.string().min(2).max(8).optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
});

const corpoSchema = z.object({
  // La stanza, quando il bridge la passa; altrimenti l'id della riunione.
  room: z.string().min(1).max(200).optional(),
  meetingId: z.string().min(1).max(64).optional(),
  segments: z.array(segmentoSchema).min(1).max(100),
});

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);
  const parsed = corpoSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const { room, meetingId, segments } = parsed.data;
  const event = await eventoDellaConferenza({ room, meetingId });
  // Un evento che non tiene la trascrizione non ne riceve: il servizio lo sa
  // dal contesto, ma un interruttore spento nel frattempo vale da subito.
  if (!event || !event.liveCaptionsEnabled || !event.captionsTranscriptEnabled) {
    return Response.json({ stored: 0 });
  }

  // Una persona per endpoint, letta una volta per richiesta.
  const persone = new Map<string, { seatId: string | null; consenso: ConsensoTrascrizione }>();
  const personaDi = async (endpointId: string) => {
    const gia = persone.get(endpointId);
    if (gia) return gia;
    const seatId = await postoDellEndpoint(event.id, endpointId);
    const consenso = seatId
      ? await consensoTrascrizione(event.id, seatId, VERSIONE_TESTO_TRASCRIZIONE)
      : { dato: false, nome: null };
    const persona = { seatId, consenso };
    persone.set(endpointId, persona);
    return persona;
  };

  const righe = [];
  for (const s of segments) {
    const { seatId, consenso } = await personaDi(s.endpointId);
    righe.push({
      eventId: event.id,
      messageId: s.messageId,
      endpointId: s.endpointId,
      seatId: consenso.dato ? seatId : null,
      speakerName: consenso.dato && consenso.nome ? encryptPII(consenso.nome) : null,
      text: consenso.dato ? encryptPII(s.text) : null,
      language: s.language ?? null,
      startedAt: new Date(s.startedAt),
      endedAt: new Date(s.endedAt),
    });
  }
  const { count } = await prisma.captionSegment.createMany({ data: righe, skipDuplicates: true });
  return Response.json({ stored: count });
});
