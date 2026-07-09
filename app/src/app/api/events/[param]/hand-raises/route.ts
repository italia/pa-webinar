import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { eventParamWhere } from '@/lib/events/event-param';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Tetto massimo di eventi conservati per CallSession: protegge la riga JsonB. */
const MAX_LOG_ENTRIES = 5000;
/** Tetto massimo di eventi accettati in un singolo batch POST. */
const MAX_BATCH = 2000;
/** Cap difensivo sulla lunghezza dei campi stringa (ids). */
const MAX_STR = 256;

const handRaiseEventSchema = z.object({
  // Opaque Jitsi endpoint id of the raiser's own session (self-reported).
  // No displayName / no timestamp is collected — the analytics only needs a
  // count + distinct sessions, so we minimize what we store (GDPR).
  participantId: z.string().min(1).max(MAX_STR),
  /** true = mano alzata; false = mano abbassata. */
  raised: z.boolean(),
});

const bodySchema = z.object({
  events: z.array(handRaiseEventSchema).min(1).max(MAX_BATCH),
});

/**
 * POST /api/events/[param]/hand-raises  (P1 analytics)
 *
 * Ingest pubblico delle alzate di mano catturate in diretta da
 * `jitsi-room.tsx` via l'IFrame API (`raiseHandUpdated`). Ogni client segnala
 * SOLO la propria alzata (l'evento è in broadcast a tutti: il self-report
 * evita il conteggio ~P×). Il batch è `{ participantId, raised }` e lo
 * appendiamo a `CallSession.handRaiseLog`.
 *
 * L'append è ATOMICO (una sola UPDATE JsonB `||` con row-lock): raccolte di
 * POST concorrenti — es. "alzate la mano tutti insieme" → decine di flush
 * quasi simultanei — non si sovrascrivono più (il precedente read-merge-write
 * perdeva aggiornamenti). Un CASE evita di superare MAX_LOG_ENTRIES.
 *
 * Stessa postura di sicurezza dell'ingest dominant-speaker (nessuna auth
 * speciale: chiunque sia nella stanza LIVE può segnalare l'evento; mitigato
 * da rate-limit per-IP + cap su batch/log). Nessuna PII: si conserva solo
 * l'endpoint id opaco della sessione, comunque scrubbato dal cleanup.
 */
export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const ip = getClientIp(request);
  // Limite generoso: è un self-report (ogni client ~6 POST/min per il debounce
  // di 10s), ma molti partecipanti dietro un solo NAT istituzionale condividono
  // l'IP, quindi teniamo il budget alto per non perdere alzate durante un picco.
  const rl = rateLimit(`hand-raises:${ip}`, { limit: 240, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid hand-raises payload');
  }
  const { events } = parsed.data;

  // Risolvi evento → CallSession ATTIVA (più recente senza endedAt).
  const event = await prisma.event.findFirst({
    where: eventParamWhere(param),
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const session = await prisma.callSession.findFirst({
    where: { eventId: event.id, endedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  if (!session) throw new NotFoundError('Active call session');

  // Append ATOMICO: `hand_raise_log || $events` prende un row-lock, quindi le
  // POST concorrenti si serializzano invece di sovrascriversi. Il CASE smette
  // di crescere oltre MAX_LOG_ENTRIES (guardia difensiva anti-bloat).
  await prisma.$executeRaw`
    UPDATE "call_sessions"
    SET "hand_raise_log" =
      CASE
        WHEN jsonb_array_length("hand_raise_log") >= ${MAX_LOG_ENTRIES}
        THEN "hand_raise_log"
        ELSE "hand_raise_log" || ${JSON.stringify(events)}::jsonb
      END
    WHERE "id" = ${session.id}::uuid
  `;

  return NextResponse.json({ ok: true, stored: events.length }, { status: 201 });
});
