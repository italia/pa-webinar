/**
 * Who is speaking in this chat?
 *
 * Extracted from the chat POST route so the message-level actions added later —
 * correcting your own message, reacting to one — resolve the sender through the
 * exact same rules instead of each re-deriving "who are you". A second
 * implementation of this is how identity bugs get in (see F7).
 */

import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, ValidationError } from '@/lib/errors';
import { resolveTokenSender } from '@/lib/chat/sender';
import { guestChatWindowOpen } from '@/lib/chat/read-access';
import { getClientIp } from '@/lib/rate-limit';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ChatAuthResult {
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
export async function authenticateChatSender(
  eventIdOrSlug: string,
  token: string | null,
  guestName: string | undefined,
  displayNameOverride: string | undefined,
  req: Request,
): Promise<ChatAuthResult> {
  const where = UUID_RE.test(eventIdOrSlug)
    ? { id: eventIdOrSlug }
    : { slug: eventIdOrSlug };
  const event = await prisma.event.findUnique({
    where,
    select: {
      id: true,
      status: true,
      eventType: true,
      moderatorToken: true,
      moderatorName: true,
    },
  });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');

  if (token) {
    // Non-guest resolution (primary moderator / co-mod / speaker / registered
    // participant) is shared with the attachment + moderation routes via
    // resolveTokenSender. Only role=MODERATOR gets the moderator badge — a
    // SPEAKER is a relatore, not staff (coerente con verifyModeratorToken).
    //
    // F7 identity binding lives inside resolveTokenSender: an owning registrant
    // gets their real DB name; a forwarded-link opener keeps the same reg-<id>
    // seat but is named from what they typed (displayNameOverride), never the
    // registrant's decrypted name. A genuinely invalid/foreign/deleted token
    // matches nothing → 403 (contract unchanged).
    const sender = await resolveTokenSender(event, token, displayNameOverride);
    if (sender) return sender;
    throw new ForbiddenError('Invalid token for this event');
  }

  // Guest branch — la chat è app-side e non dipende dal JVB. Consentita:
  //   • su qualunque evento LIVE (comportamento storico), e
  //   • durante il warm-up del bridge (PROVISIONING/IDLE) SOLO per le call
  //     INSTANT — aperte per link, senza gate d'orario — dove la sala
  //     d'attesa mostra la chat mentre il bridge si scalda.
  // Gli eventi schedulati/con password NON ammettono guest senza token fuori
  // dal LIVE: /wake è non autenticato e chiunque potrebbe flippare
  // PUBLISHED→PROVISIONING per iniettare messaggi anonimi (regressione chiusa).
  // Shared with the read side (lib/chat/read-access) so the guest write window
  // and the guest read window can never drift apart.
  if (!guestChatWindowOpen(event)) {
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
