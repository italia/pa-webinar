// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * PUT /api/events/[param]/nickname  { nickname: string | null }
 *
 * Il nickname di chi partecipa (lib/live/nickname), dalla sala d'attesa o
 * dalla sala.
 *
 * - Chi si e' iscritto, dal browser con cui si e' iscritto (il token
 *   dell'iscrizione come `Authorization: Bearer` e il cookie dell'evento): il
 *   nickname si salva sull'iscrizione, o si toglie con null. Vale da subito in
 *   chat e nelle domande; in video dal prossimo ingresso, che la sala fa
 *   subito. Toglierlo e' sempre possibile, sceglierne uno solo se l'evento lo
 *   consente.
 * - Un ospite, o chi apre il link di un altro: il controllo soltanto, senza
 *   salvare niente. Il nickname e' della visita, e lo prende la rotta del
 *   token all'ingresso.
 * - Chi conduce compare con il suo nome: 403.
 *
 * 200 { nickname, saved }; 422 NICKNAME_INVALID con il motivo; 409
 * NICKNAME_TAKEN con un'alternativa libera; 403 NICKNAMES_DISABLED se
 * l'evento non li consente.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken, resolveGrantForEvent } from '@/lib/auth/moderator';
import { guestSenderId } from '@/lib/chat/sender-key';
import { prisma } from '@/lib/db';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { readOwnedEventAccessToken } from '@/lib/event-session';
import { normalizzaNickname } from '@/lib/live/nickname-rule';
import {
  rispostaNicknameRifiutato,
  salvaNicknameIscrizione,
  verificaNickname,
} from '@/lib/live/nickname';
import { guestWindowOpen } from '@/lib/events/guest-window';
import { hasJoinGrant } from '@/lib/events/join-grant';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { limiteDellaSala } from '@/lib/room-rate-limit';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const schema = z.object({ nickname: z.string().max(100).nullable() }).strict();

/** Gli stati in cui la sala e' finita: un nickname nuovo non serve piu'. */
const CONCLUSO = ['ENDED', 'ARCHIVED'];

export const PUT = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;
  const ip = getClientIp(request);
  // Una persona lo prova qualche volta, ma un ufficio dietro un solo indirizzo
  // entra tutto insieme: il tetto scala come gli altri limiti della sala. Chi
  // volesse scoprire quali nickname sono presi deve poter entrare (sotto), e
  // da dentro li vede comunque in sala.
  const rl = rateLimit(`nickname:${ip}`, {
    limit: limiteDellaSala(120),
    windowMs: 60_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  const parsed = schema.safeParse(await parseJsonBody(request, 1024));
  if (!parsed.success) throw new ValidationError('Invalid body');
  const richiesto =
    parsed.data.nickname === null ? null : normalizzaNickname(parsed.data.nickname);

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      nicknamesEnabled: true,
      audienceAnonymous: true,
      eventType: true,
      accessMode: true,
      joinPasswordHash: true,
      moderatorToken: true,
      moderatorName: true,
    },
  });
  if (!event) throw new NotFoundError('Event');

  const token = extractModeratorToken(request);
  const registration = token
    ? await prisma.registration.findUnique({
        where: { accessToken: token },
        select: { id: true, eventId: true },
      })
    : null;
  const dellEvento =
    registration && registration.eventId === event.id ? registration : null;
  if (token && !dellEvento) {
    // Chi conduce non sceglie un nickname: e' nel video con il suo nome.
    if (await resolveGrantForEvent(event, token)) {
      throw new AppError('Hosts appear with their own name', 403, 'HOSTS_USE_THEIR_NAME');
    }
    throw new ForbiddenError('Invalid token for this event');
  }
  const suo = dellEvento ? (await readOwnedEventAccessToken(event.id)) === token : false;

  // Toglierlo resta possibile anche a opzione spenta o a evento concluso.
  if (richiesto === null) {
    if (dellEvento && suo) await salvaNicknameIscrizione(event.id, dellEvento.id, null);
    return Response.json(
      { nickname: null, saved: !!(dellEvento && suo) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (!event.nicknamesEnabled) {
    throw new AppError(
      'Nicknames are not enabled for this event',
      403,
      'NICKNAMES_DISABLED'
    );
  }
  if (CONCLUSO.includes(event.status)) {
    throw new AppError('The event is over', 409, 'EVENT_ENDED');
  }

  if (dellEvento && suo) {
    const esito = await salvaNicknameIscrizione(event.id, dellEvento.id, richiesto);
    if (!esito.ok) return rispostaNicknameRifiutato(esito);
    return Response.json(
      { nickname: esito.nickname, saved: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
  // Chi apre il link di un altro col pubblico anonimo resta con lo pseudonimo
  // del posto (vedi la rotta del token).
  if (dellEvento && event.audienceAnonymous) {
    throw new AppError(
      'Nicknames are not available on a forwarded link',
      403,
      'NICKNAMES_DISABLED'
    );
  }
  // Un ospite prova il nickname solo dove potrebbe entrare: altrimenti la
  // risposta direbbe a chiunque quali nomi hanno chi conduce e chi partecipa.
  if (
    !dellEvento &&
    (!guestWindowOpen(event, (await getSettings()).guestAccessEnabled) ||
      (event.joinPasswordHash && !(await hasJoinGrant(event.id))))
  ) {
    throw new ForbiddenError('The room is not open to guests');
  }
  const esito = await verificaNickname(event.id, richiesto, {
    ospite: guestSenderId(ip, richiesto),
  });
  if (!esito.ok) return rispostaNicknameRifiutato(esito);
  return Response.json(
    { nickname: esito.nickname, saved: false },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
