/**
 * Read-side authorization for chat history and the SSE stream.
 *
 * WHY THIS EXISTS: `GET /chat` and `GET /chat/stream` used to be completely
 * unauthenticated. Chat rows carry PII (attendee display names plus whatever
 * they typed), so anyone who knew a slug could fetch the full transcript of any
 * event, in any status, forever — verified on prod: an ENDED event returned 25
 * messages with real first/last names and `reg-<uuid>` seat ids to an anonymous
 * curl. The POST side had elaborate auth; the read side had none.
 *
 * Readers now clear the SAME bar as writers (see `authenticateSender` in the
 * chat route), minus the display name a reader has no need for:
 *   • a valid grant token (primary moderator link, per-row co-moderator or
 *     speaker) or a registration accessToken for THIS event → allowed in any
 *     status, so moderators keep post-event access to the archive;
 *   • no token → only while the room is genuinely open to guests, i.e. the same
 *     LIVE / INSTANT-warm-up window that lets a guest POST. This is what closes
 *     the "readable forever after the event" hole without breaking the public
 *     link flow.
 *
 * Deliberately lighter than `resolveTokenSender`: it answers "may you read?",
 * not "who are you?", so it never reads the event_access cookie and never
 * decrypts a name. That keeps the SSE stream — which runs outside the normal
 * route handler wrapper — free of request-scope dependencies.
 */

import { resolveGrantForEvent } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError } from '@/lib/errors';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ChatReadAccess {
  eventId: string;
  /** True when a token identified the caller as a grant holder or registrant. */
  isMember: boolean;
}

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
 *         reader asks for an event outside the guest window
 */
export async function authorizeChatRead(
  eventIdOrSlug: string,
  token: string | null,
): Promise<ChatReadAccess> {
  const event = await prisma.event.findUnique({
    where: UUID_RE.test(eventIdOrSlug)
      ? { id: eventIdOrSlug }
      : { slug: eventIdOrSlug },
    select: {
      id: true,
      status: true,
      eventType: true,
      moderatorToken: true,
    },
  });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');

  if (token) {
    const grant = await resolveGrantForEvent(event, token);
    if (grant) return { eventId: event.id, isMember: true };

    const registration = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { eventId: true },
    });
    if (registration && registration.eventId === event.id) {
      return { eventId: event.id, isMember: true };
    }
    // A token that matches nothing is an error, not a downgrade to guest: same
    // contract as the POST route, so a stale/foreign token fails loudly instead
    // of silently reading as an anonymous visitor.
    throw new ForbiddenError('Invalid token for this event');
  }

  if (!guestChatWindowOpen(event)) {
    throw new ForbiddenError('Chat requires a participant or moderator token');
  }
  return { eventId: event.id, isMember: false };
}
