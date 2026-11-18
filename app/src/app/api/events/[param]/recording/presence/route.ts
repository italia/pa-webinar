// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/events/[param]/recording/presence  { roomTokens: string[] }
 *
 * Il pass di presenza di una chiamata rapida (lib/recording/presence-pass):
 * lo chiede la sala di chi e' in chiamata quando la registrazione parte, o
 * entrando a registrazione in corso. Chi lo chiede prova il proprio posto con
 * i token della sala che il portale gli ha consegnato in questa visita della
 * pagina (lib/auth/jwt postoDaTokenSala), come per il ritiro dei consensi:
 * nessun altro dato. Vale per chiunque sia in sala, abbia acconsentito o no a
 * comparire nel video.
 *
 * Il server verifica che sia una chiamata rapida, che la sala sia aperta, che
 * la registrazione sia in corso (l'ultima azione della sala e' l'avvio della
 * registrazione, lib/live/actions) e che il token sia di questa stanza. Poi
 * posa il cookie HttpOnly firmato, che scade con la conservazione della
 * chiamata. Il link della chiamata fa entrare chiunque lo abbia, e il pass non
 * da' di piu': chi lo chiede con un token della chiamata c'era, o poteva
 * esserci.
 *
 * 409 `RECORDING_NOT_RUNNING` finche' l'avvio non e' arrivato al server (lo
 * riferisce chi modera, a volte un attimo dopo che la sala lo vede): il client
 * riprova.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { postoDaTokenSala } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { limiteDellaSala } from '@/lib/room-rate-limit';
import {
  buildPresencePassSetCookie,
  issuePresencePass,
  scadenzaPass,
} from '@/lib/recording/presence-pass';

export const dynamic = 'force-dynamic';

const corpoSchema = z
  .object({ roomTokens: z.array(z.string().min(1).max(4096)).min(1).max(50) })
  .strict();

/** La sala e' aperta: si entra e si registra solo in questi stati. */
const SALA_APERTA = new Set(['LIVE', 'IDLE', 'PROVISIONING']);

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };

  // Per indirizzo, scalato come le altre azioni della sala: dietro la rete di un
  // ufficio molte persone escono con lo stesso indirizzo, e chiedono il pass
  // tutte insieme all'avvio della registrazione.
  const rl = rateLimit(`recording-presence:${getClientIp(request)}`, {
    limit: limiteDellaSala(30),
    windowMs: 60_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const parsed = corpoSchema.safeParse(await parseJsonBody(request));
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
      eventType: true,
      status: true,
      jitsiRoomName: true,
      endsAt: true,
      dataRetentionDays: true,
    },
  });
  // Solo le chiamate rapide: gli eventi a calendario riconoscono chi c'era
  // dall'iscrizione (lib/recording/audience).
  if (!event || event.eventType !== 'INSTANT') throw new NotFoundError('Event');
  if (!SALA_APERTA.has(event.status)) {
    throw new AppError('The call is not open', 409, 'CALL_NOT_OPEN');
  }

  // Un posto in questa sala: un token di questa stanza firmato dal portale.
  // Vale anche scaduto da poco (postoDaTokenSala): la sala non lo rinnova
  // finche' si resta collegati, e una registrazione avviata a ore dall'ingresso
  // trova scaduto il token di chi c'e' da allora.
  const prove = await Promise.all(
    parsed.data.roomTokens.map((t) =>
      postoDaTokenSala(t, event.jitsiRoomName, { ancheChiModera: true })
    )
  );
  if (!prove.some((p) => p !== null)) {
    throw new AppError('No valid room token for this call', 401, 'ROOM_TOKEN_INVALID');
  }

  const ultima = await prisma.liveAction.findFirst({
    where: {
      eventId: event.id,
      kind: { in: ['recording.started', 'recording.stopped'] },
    },
    orderBy: { at: 'desc' },
    select: { kind: true },
  });
  if (ultima?.kind !== 'recording.started') {
    throw new AppError('The call is not being recorded', 409, 'RECORDING_NOT_RUNNING');
  }

  const adesso = new Date();
  const scadenza = scadenzaPass(event, adesso);
  const pass = issuePresencePass(event.id, scadenza);
  if (!pass) throw new AppError('Presence pass unavailable', 503, 'PASS_UNAVAILABLE');

  return new Response(null, {
    status: 204,
    headers: {
      'Set-Cookie': buildPresencePassSetCookie(event.id, pass, scadenza, adesso),
      'Cache-Control': 'no-store',
    },
  });
});
