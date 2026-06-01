import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tetto massimo di eventi conservati per CallSession: protegge la riga JsonB. */
const MAX_LOG_ENTRIES = 5000;
/** Tetto massimo di eventi accettati in un singolo batch POST. */
const MAX_BATCH = 2000;
/** Cap difensivo sulla lunghezza dei campi stringa (PII / ids). */
const MAX_STR = 256;

const speakerEventSchema = z.object({
  atMs: z.number().int().min(0),
  participantId: z.string().min(1).max(MAX_STR),
  displayName: z.string().max(MAX_STR).optional(),
});

const bodySchema = z.object({
  events: z.array(speakerEventSchema).min(1).max(MAX_BATCH),
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

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid speaker-events payload');
  }
  const { events } = parsed.data;

  // Risolvi evento → CallSession ATTIVA (più recente senza endedAt).
  const event = await prisma.event.findFirst({
    where: eventWhereClause(param),
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const session = await prisma.callSession.findFirst({
    where: { eventId: event.id, endedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true, dominantSpeakerLog: true },
  });
  if (!session) throw new NotFoundError('Active call session');

  // Leggi-merge-scrivi: appendi i nuovi eventi al log esistente, capped.
  const existing = Array.isArray(session.dominantSpeakerLog)
    ? (session.dominantSpeakerLog as unknown as SpeakerEvent[])
    : [];

  const merged = existing.concat(events);
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
