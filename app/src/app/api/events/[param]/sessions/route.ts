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
 * Idempotently "open" a CallSession for the event. Called by the live
 * page immediately after the first Jitsi `videoConferenceJoined` event,
 * so every live event has a row in `call_sessions` with real start/end
 * timestamps — even when no recording is ever started. Prior to this
 * route the only code-path creating a CallSession was the Jibri
 * recording webhook, so non-recorded calls left no analytics trail.
 *
 * Behavior:
 *   - If an open session (`endedAt IS NULL`) already exists for the
 *     event, returns its id (no DB write).
 *   - Otherwise creates a new row with startedAt=now, endedAt=null,
 *     peakParticipants=0.
 *   - Rate limited by IP (first-joiner call) to protect against loop
 *     abuse; idempotent so retries are safe.
 *
 * Closing: the scaler closes open sessions when an event transitions
 * LIVE → IDLE or anything → ENDED (scaler route handles the update).
 * The recording webhook, if a recording finishes mid-session, updates
 * the same row with the recording URL / size / duration instead of
 * creating a second row.
 *
 * No auth: anyone who got as far as opening the live URL of a LIVE
 * event can signal that they've joined.
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

  // Idempotency: reuse the open session if one already exists. We can't
  // use an @@unique constraint on (eventId, endedAt) because Postgres
  // treats NULLs as distinct; this findFirst + create sequence is
  // effectively single-writer under our traffic levels and races just
  // produce an extra row (cleanup script merges them).
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
