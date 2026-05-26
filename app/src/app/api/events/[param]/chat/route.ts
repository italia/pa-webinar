/**
 * In-app chat endpoints for live events.
 *
 *   GET  /chat[?since=<iso>&limit=<n>]  →  paginated history (most
 *       recent first). Useful on (a) mount — rehydrate the panel with
 *       what happened so far — and (b) post-event — archive view in
 *       the moderator UI.
 *
 *   POST /chat                           →  submit a new message.
 *       Auth: participant accessToken OR moderator token OR guest
 *       (only while event.status === 'LIVE'). Guest sender-name comes
 *       from the body (untrusted, same risk profile as Jitsi pre-join
 *       display-name). Message is persisted to Postgres and published
 *       on Redis for real-time fan-out to SSE subscribers on any pod.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import {
  AppError,
  ForbiddenError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { publishChat } from '@/lib/chat/pubsub';
import { chatMessagesTotal } from '@/lib/metrics';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HISTORY_DEFAULT_LIMIT = 100;
const HISTORY_MAX_LIMIT = 500;
const MESSAGE_MAX_LENGTH = 2000;

const postSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'empty message')
    .max(MESSAGE_MAX_LENGTH),
  // Provided by guests only — participants and moderators derive the
  // name from their token lookup. Ignored for those branches.
  guestName: z.string().trim().min(1).max(80).optional(),
});

interface AuthResult {
  eventId: string;
  senderId: string;
  senderName: string;
  isModerator: boolean;
}

/**
 * Resolve the caller to one of {moderator, registered participant,
 * guest-on-live-event}. Throws Forbidden otherwise.
 *
 * Token is read from `?token=` (what the live page already passes)
 * and the event is looked up by slug OR id.
 */
async function authenticateSender(
  eventIdOrSlug: string,
  token: string | null,
  guestName: string | undefined,
  req: Request,
): Promise<AuthResult> {
  const where = UUID_RE.test(eventIdOrSlug)
    ? { id: eventIdOrSlug }
    : { slug: eventIdOrSlug };
  const event = await prisma.event.findUnique({
    where,
    select: { id: true, status: true, moderatorToken: true, moderatorName: true },
  });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');

  if (token) {
    // Primary moderator?
    if (constantTimeEqual(event.moderatorToken, token)) {
      return {
        eventId: event.id,
        senderId: `mod-${event.id}-primary`,
        senderName: event.moderatorName ?? 'Moderatore',
        isModerator: true,
      };
    }
    // Co-moderator?
    const coMod = await prisma.eventModerator.findUnique({
      where: { token },
      select: { id: true, name: true, eventId: true, revokedAt: true },
    });
    if (coMod && coMod.eventId === event.id && coMod.revokedAt === null) {
      return {
        eventId: event.id,
        senderId: `mod-${event.id}-${coMod.id}`,
        senderName: coMod.name,
        isModerator: true,
      };
    }
    // Registered participant via accessToken?
    const registration = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { id: true, displayName: true, eventId: true },
    });
    if (registration && registration.eventId === event.id) {
      return {
        eventId: event.id,
        senderId: `reg-${registration.id}`,
        senderName: registration.displayName,
        isModerator: false,
      };
    }
    throw new ForbiddenError('Invalid token for this event');
  }

  // Guest branch — only allowed while the event is live (mirrors
  // /events/[slug]/live guest access policy).
  if (event.status !== 'LIVE') {
    throw new ForbiddenError('Chat requires a participant or moderator token');
  }
  const name = (guestName ?? '').trim();
  if (name.length < 1) {
    throw new ValidationError('Guest display name required', [
      { path: ['guestName'], message: 'required for unauthenticated chat' },
    ]);
  }
  // We anchor the guest id to the client IP + name so reloading or
  // reconnecting keeps the same senderId across messages. Not secure
  // in any way — it's purely a display hint for UI clustering (same
  // bubble colour, AI summary "this attendee said 3 things").
  const ip = getClientIp(req);
  return {
    eventId: event.id,
    senderId: `guest-${Buffer.from(`${ip}:${name}`).toString('base64url').slice(0, 24)}`,
    senderName: name,
    isModerator: false,
  };
}

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const url = new URL(request.url);
  const since = url.searchParams.get('since');
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') ?? String(HISTORY_DEFAULT_LIMIT), 10),
    HISTORY_MAX_LIMIT,
  );

  const where = UUID_RE.test(param)
    ? { id: param }
    : { slug: param };
  const event = await prisma.event.findUnique({
    where,
    select: { id: true },
  });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');

  const rows = await prisma.chatMessage.findMany({
    where: {
      eventId: event.id,
      hiddenAt: null,
      ...(since && { createdAt: { gt: new Date(since) } }),
    },
    orderBy: { createdAt: since ? 'asc' : 'desc' },
    take: limit,
    select: {
      id: true,
      senderId: true,
      senderName: true,
      isModerator: true,
      text: true,
      createdAt: true,
    },
  });

  // When no `since` is passed the client wants the most recent N —
  // we queried desc for that, but the UI renders oldest-first so we
  // reverse here. With `since` we already queried asc (incremental
  // catch-up) so the order is already correct.
  const ordered = since ? rows : rows.slice().reverse();

  return NextResponse.json({
    messages: ordered.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: m.senderName,
      isModerator: m.isModerator,
      text: m.text,
      createdAt: m.createdAt.toISOString(),
    })),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);

  const body = await parseJsonBody(request);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const auth = await authenticateSender(param, token, parsed.data.guestName, request);

  // Per-sender rate limit: keep chat flowing for a normal speaker
  // (~1 message/sec bursts) but prevent spam / accidental paste loops.
  const rl = rateLimit(`chat:${auth.eventId}:${auth.senderId}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const created = await prisma.chatMessage.create({
    data: {
      eventId: auth.eventId,
      senderId: auth.senderId,
      senderName: auth.senderName,
      isModerator: auth.isModerator,
      text: parsed.data.text,
    },
  });
  chatMessagesTotal.inc({ event_id: auth.eventId });

  // Fire-and-forget Redis fan-out — persistence is already done, and
  // pubsub failure is survivable (clients fall back to GET /history
  // polling on reconnect).
  void publishChat({
    id: created.id,
    eventId: created.eventId,
    senderId: created.senderId,
    senderName: created.senderName,
    isModerator: created.isModerator,
    text: created.text,
    createdAt: created.createdAt.toISOString(),
  });

  return NextResponse.json({
    id: created.id,
    createdAt: created.createdAt.toISOString(),
  }, { status: 201 });
});
