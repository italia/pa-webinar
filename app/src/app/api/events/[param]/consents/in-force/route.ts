// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/events/[param]/consents/in-force
 *
 * I consensi che valgono adesso per chi e' in sala, senza un token nuovo e senza
 * ricollegare la conferenza: la sala li rilegge quando si apre la finestra «I tuoi
 * consensi» e quando chi modera cambia i sottotitoli (lib/live/consents-in-force).
 * Chi chiede prova i propri posti con i token della sala di questa visita
 * (lib/auth/jwt postoDaTokenSala), nell'ordine in cui li ha ricevuti: nessun altro
 * dato, e nel corpo, perche' un token non finisca nei log di un indirizzo.
 *
 * Le stesse persone chiedono nello stesso momento quando cambia il flag, e un
 * ufficio esce da un solo indirizzo: il limite e' largo e scala con quelli della
 * sala, e una richiesta scartata lascia solo lo stato di prima, verso il chiuso.
 */
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { postoDaTokenSala } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { consensiInVigoreDeiPosti } from '@/lib/live/consents-in-force';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { partecipantiNelVideo } from '@/lib/recording/availability';
import { destinazioneDelTesto } from '@/lib/recording/destination';
import { limiteDellaSala } from '@/lib/room-rate-limit';
import { consentsInForceSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const ip = getClientIp(request);
  const rl = rateLimit(`consents-in-force:${ip}`, { limit: limiteDellaSala(300), windowMs: 60_000 });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const parsed = consentsInForceSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      jitsiRoomName: true,
      eventType: true,
      recordingEnabled: true,
      recordingDestination: true,
      multitrackRecordingEnabled: true,
      captionsTranscriptEnabled: true,
      liveCaptionsEnabled: true,
      aiTranscriptEnabled: true,
    },
  });
  if (!event) throw new NotFoundError('Event');

  const prove = await Promise.all(
    parsed.data.roomTokens.map((t) =>
      postoDaTokenSala(t, event.jitsiRoomName, { ancheChiModera: true })
    )
  );
  const posti = prove.filter((p) => p !== null).map((p) => p.posto);
  if (posti.length === 0) {
    throw new AppError('No valid room token for this event', 401, 'ROOM_TOKEN_INVALID');
  }

  const destinazione = destinazioneDelTesto(event.recordingDestination, partecipantiNelVideo());
  const consensi = await consensiInVigoreDeiPosti(event, posti, destinazione);
  return Response.json(
    { ...consensi, recordingDestination: destinazione },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
