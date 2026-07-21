/**
 * Read-side authorization for chat history and the SSE stream.
 *
 * WHY THIS EXISTS: `GET /chat` and `GET /chat/stream` used to be completely
 * unauthenticated. Chat rows carry PII (attendee display names plus whatever
 * they typed), so anyone who knew a slug could fetch the full transcript of any
 * event, in any status, forever — verified on prod: an anonymous curl against
 * an ENDED event returned 25 messages with real names. The POST side had
 * elaborate auth; the read side had none.
 *
 * Readers now clear the same bar as writers (see `authenticateSender` in the
 * chat route), minus the display name a reader has no need for:
 *   • a valid grant token (primary moderator link, per-row co-moderator or
 *     speaker) or a registration accessToken for THIS event → allowed in any
 *     status, so moderators keep post-event access to the archive;
 *   • no token → only while the room is genuinely open to guests, i.e. the same
 *     LIVE / INSTANT-warm-up window that lets a guest POST, AND only when the
 *     event is not password-protected. The password check is the one place the
 *     read side is deliberately STRICTER than the write side: posting injects a
 *     message, reading exfiltrates everyone else's, so "I have the URL" cannot
 *     be enough for an event whose whole point is that the URL isn't enough.
 *
 * Deliberately lighter than `resolveTokenSender`: it answers "may you read?",
 * not "who are you?", so it never decrypts a name. That keeps the SSE stream —
 * which runs outside the normal route handler wrapper — cheap.
 */

import { resolveGrantForEvent } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError } from '@/lib/errors';
import { eventParamWhere } from '@/lib/events/event-param';
import { hasJoinGrant } from '@/lib/events/join-grant';

/** Status window in which an anonymous reader may follow the chat. Mirrors the
 *  guest POST branch exactly — if you may write here, you may read here. */
export function guestChatWindowOpen(event: {
  status: string;
  eventType: string;
}): boolean {
  return (
    event.status === 'LIVE' ||
    (event.eventType === 'INSTANT' &&
      (event.status === 'PROVISIONING' || event.status === 'IDLE'))
  );
}

/**
 * Resolve read access or throw. Returns the event id so callers don't repeat
 * the slug/uuid lookup.
 *
 * @throws AppError(404) when the event does not exist
 * @throws ForbiddenError when the token matches nothing, or when an anonymous
 *         reader asks for an event outside the guest window / behind a password
 */
export async function authorizeChatRead(
  eventIdOrSlug: string,
  token: string | null,
): Promise<{ eventId: string }> {
  const event = await prisma.event.findFirst({
    where: eventParamWhere(eventIdOrSlug),
    select: {
      id: true,
      status: true,
      eventType: true,
      moderatorToken: true,
      joinPasswordHash: true,
    },
  });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');

  if (token) {
    const grant = await resolveGrantForEvent(event, token);
    if (grant) return { eventId: event.id };

    const registration = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { eventId: true },
    });
    if (registration && registration.eventId === event.id) {
      return { eventId: event.id };
    }
    // A token that matches nothing is an error, not a downgrade to guest: same
    // contract as the POST route, so a stale/foreign token fails loudly instead
    // of silently reading as an anonymous visitor.
    throw new ForbiddenError('Invalid token for this event');
  }

  if (!guestChatWindowOpen(event)) {
    throw new ForbiddenError('Chat requires a participant or moderator token');
  }

  // A password-protected event: knowing the URL is explicitly not enough to get
  // into the room, so it must not be enough to read the room either. The grant
  // cookie is the same one the live page requires before issuing a guest JWT.
  if (event.joinPasswordHash && !(await hasJoinGrant(event.id))) {
    throw new ForbiddenError('Chat requires the event join password');
  }

  return { eventId: event.id };
}
