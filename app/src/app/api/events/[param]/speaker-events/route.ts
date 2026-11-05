// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { postoDaTokenSala } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db';
import { NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { endpointSenzaRegistrazione } from '@/lib/captions/room';
import { statoCattura } from '@/lib/live/capture-state';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { recordingAvailable } from '@/lib/recording/availability';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tetto massimo di eventi conservati per CallSession: protegge la riga JsonB. */
const MAX_LOG_ENTRIES = 5000;
/** Tetto massimo di eventi accettati in un singolo batch POST. */
const MAX_BATCH = 2000;
/** Cap difensivo sulla lunghezza dei campi stringa (PII / ids). */
const MAX_STR = 256;
/** I lotti arrivano ogni 10 secondi: chi ha parlato appena prima dello stop conta ancora. */
const MARGINE_LOTTO_MS = 15_000;

const speakerEventSchema = z.object({
  atMs: z.number().int().min(0),
  participantId: z.string().min(1).max(MAX_STR),
  displayName: z.string().max(MAX_STR).optional(),
});

const bodySchema = z.object({
  events: z.array(speakerEventSchema).min(1).max(MAX_BATCH),
  /** Il token di sala: serve solo per la nota pubblica accanto al video. */
  roomToken: z.string().min(1).max(8192).optional(),
});

type SpeakerEvent = z.infer<typeof speakerEventSchema>;

function eventWhereClause(param: string) {
  return UUID_RE.test(param)
    ? { OR: [{ id: param }, { slug: param }] }
    : { slug: param };
}

/**
 * POST /api/events/[param]/speaker-events  (ADR-013 Fase 0)
 *
 * Ingest pubblico della timeline dominant-speaker catturata in diretta da
 * `jitsi-room.tsx` via l'IFrame API. Il client invia batch di eventi
 * `{ atMs, participantId, displayName }`; qui li appendiamo al campo
 * `CallSession.dominantSpeakerLog` (JsonB append-only, capped).
 *
 * Niente auth speciale: chiunque sia arrivato nella stanza LIVE può
 * segnalare i cambi di dominant speaker. È mitigato da:
 *   - rate limit per-IP,
 *   - cap sul batch e sulla dimensione totale del log,
 *   - cap sulla lunghezza dei campi stringa.
 *
 * Il displayName NON viene cifrato qui: è PII gestita a valle (post-prod),
 * coerentemente con la nota sullo schema. Lo conserviamo così com'è ma
 * capped in dimensione.
 */
export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const ip = getClientIp(request);
  const rl = rateLimit(`speaker-events:${ip}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid speaker-events payload');
  }
  const { events, roomToken } = parsed.data;

  // Risolvi evento → CallSession ATTIVA (più recente senza endedAt).
  const event = await prisma.event.findFirst({
    where: eventWhereClause(param),
    select: {
      id: true,
      status: true,
      jitsiRoomName: true,
      unrecordedSpeech: true,
      recordingEnabled: true,
      aiTranscriptEnabled: true,
      multitrackRecordingEnabled: true,
      captionsTranscriptEnabled: true,
      liveCaptionsEnabled: true,
    },
  });
  if (!event) throw new NotFoundError('Event');

  const session = await prisma.callSession.findFirst({
    where: { eventId: event.id, endedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true, dominantSpeakerLog: true },
  });
  if (!session) throw new NotFoundError('Active call session');

  // Leggi-merge-scrivi: appendi i nuovi eventi al log esistente, capped.
  const existing = Array.isArray(session.dominantSpeakerLog)
    ? (session.dominantSpeakerLog as unknown as SpeakerEvent[])
    : [];

  // Il nome di chi non ha un consenso valido alla registrazione non resta nella
  // cronologia. E se parla mentre si registra resta sull'evento: la pagina lo
  // dice accanto al video, dove il suo intervento non c'e'. La nota e' pubblica,
  // quindi serve la prova di essere in sala: chi e' in sala sente chi parla.
  const senzaNome = new Set(await endpointSenzaRegistrazione(event.id));
  const nuovi = events.map(({ displayName, ...evento }) => ({
    ...evento,
    ...(senzaNome.has(evento.participantId) ? {} : { displayName }),
  }));
  const parlaChiEscluso = nuovi.some((e) => senzaNome.has(e.participantId));
  if (parlaChiEscluso && roomToken && !event.unrecordedSpeech) {
    const presente = await postoDaTokenSala(roomToken, event.jitsiRoomName, { ancheChiModera: true });
    if (presente) {
      // Il comando di sala dice se il video sta girando. Senza comandi, in questa
      // sessione, c'e' solo il registratore per persona, che dura per tutta la diretta.
      const ultima = await prisma.liveAction.findFirst({
        where: {
          eventId: event.id,
          at: { gte: session.startedAt },
          kind: { in: ['recording.started', 'recording.stopped'] },
        },
        orderBy: { at: 'desc' },
        select: { kind: true, at: true },
      });
      const siRegistra = ultima
        ? ultima.kind === 'recording.started' || Date.now() - ultima.at.getTime() < MARGINE_LOTTO_MS
        : statoCattura(event, {}, recordingAvailable()).registrazione;
      if (siRegistra) {
        await prisma.event.updateMany({
          where: { id: event.id, unrecordedSpeech: false },
          data: { unrecordedSpeech: true },
        });
      }
    }
  }

  const merged = existing.concat(nuovi);
  // Mantieni gli ultimi MAX_LOG_ENTRIES (i più recenti sono i più utili in
  // caso di troncamento; comunque è una protezione, non il caso normale).
  const capped =
    merged.length > MAX_LOG_ENTRIES
      ? merged.slice(merged.length - MAX_LOG_ENTRIES)
      : merged;

  await prisma.callSession.update({
    where: { id: session.id },
    data: { dominantSpeakerLog: capped },
  });

  return NextResponse.json({ ok: true, stored: capped.length }, { status: 201 });
});
