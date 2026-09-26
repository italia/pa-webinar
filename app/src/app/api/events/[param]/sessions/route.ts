import { withErrorHandling } from '@/lib/api-handler';
import { AppError, ForbiddenError, NotFoundError, RateLimitError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { extractModeratorToken } from '@/lib/auth/moderator';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { tryDecryptJSON } from '@/lib/crypto/pii';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new ForbiddenError('Moderator token required');

  const isUuid = UUID_RE.test(param);
  const event = await prisma.event.findFirst({
    where: {
      ...(isUuid ? { OR: [{ id: param }, { slug: param }] } : { slug: param }),
      moderatorToken: token,
    },
    select: { id: true },
  });

  if (!event) throw new NotFoundError('Event');

  const sessions = await prisma.callSession.findMany({
    where: { eventId: event.id },
    orderBy: { startedAt: 'desc' },
  });

  return Response.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      jitsiRoomName: s.jitsiRoomName,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      duration: s.duration,
      peakParticipants: s.peakParticipants,
      participants: tryDecryptJSON(s.participants, []),
      recordingUrl: s.recordingUrl,
      recordingFileSize: s.recordingFileSize ? Number(s.recordingFileSize) : null,
      recordingDuration: s.recordingDuration,
      recordingFilename: s.recordingFilename,
      telemetry: s.telemetry,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

/**
 * POST /api/events/[slug]/sessions
 *
 * Apre, in modo idempotente, una CallSession per l'evento. La chiama la
 * pagina live subito dopo il primo `videoConferenceJoined` di Jitsi, così ogni
 * evento andato in onda ha una riga in `call_sessions` con inizio e fine
 * reali, anche senza registrazione.
 *
 * Comportamento:
 *   - se l'evento ha già una sessione aperta (`endedAt IS NULL`) ne
 *     restituisce l'id, senza scrivere;
 *   - altrimenti crea una riga con startedAt=adesso, endedAt=null,
 *     peakParticipants=0;
 *   - limitata per IP contro i cicli; idempotente, quindi i tentativi
 *     ripetuti sono sicuri.
 *
 * Chiusura: la sessione si chiude a ogni uscita dell'evento da LIVE, nella
 * stessa transazione del cambio di stato (lib/events/call-sessions.ts): lo
 * fanno entrambi i giri del ciclo di vita — quello dello scaler
 * (GET /api/internal/jvb-desired-replicas) e quello a bridge fisso
 * (GET /api/cron/lifecycle) — la modifica di stato manuale
 * (PUT /api/events/[id]), l'archiviazione in blocco e il cleanup GDPR. A fine
 * giro, entrambi i giri chiudono anche le sessioni rimaste aperte su eventi
 * già ENDED o ARCHIVED.
 *
 * Nessuna autenticazione: chiunque sia arrivato alla pagina live di un
 * evento LIVE può segnalare di essere entrato.
 */
export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const ip = getClientIp(request);
  const rl = rateLimit(`session-open:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const isUuid = UUID_RE.test(param);
  const event = await prisma.event.findFirst({
    where: isUuid ? { OR: [{ id: param }, { slug: param }] } : { slug: param },
    select: { id: true, status: true, jitsiRoomName: true },
  });

  if (!event) throw new NotFoundError('Event');
  // Only open a session when the room is actually serving people. We
  // don't want drive-by pokes on PUBLISHED/IDLE/ENDED events to create
  // rows with noisy timestamps.
  if (event.status !== 'LIVE' && event.status !== 'PROVISIONING') {
    throw new AppError('Event not live', 409, 'CONFLICT');
  }

  // Idempotenza: si riusa la sessione aperta, se c'e'. Un vincolo @@unique su
  // (eventId, endedAt) non servirebbe, perche' Postgres considera distinti i
  // NULL. Due primi ingressi simultanei possono aprire una riga in piu': nessuno
  // la unisce all'altra, ma si chiude con lei, perche' l'uscita da LIVE chiude
  // tutte le sessioni aperte dell'evento (lib/events/call-sessions.ts).
  const existing = await prisma.callSession.findFirst({
    where: { eventId: event.id, endedAt: null },
    select: { id: true, startedAt: true },
  });
  if (existing) {
    return Response.json({ id: existing.id, createdNow: false, startedAt: existing.startedAt.toISOString() });
  }

  const created = await prisma.callSession.create({
    data: {
      eventId: event.id,
      jitsiRoomName: event.jitsiRoomName,
      startedAt: new Date(),
      peakParticipants: 0,
    },
  });

  return Response.json(
    { id: created.id, createdNow: true, startedAt: created.startedAt.toISOString() },
    { status: 201 },
  );
});
