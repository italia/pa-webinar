/**
 * Shared resolution of a chat sender from a token (the NON-guest paths:
 * moderator primary link, per-row co-moderator/speaker grant, or a registered
 * participant's accessToken). Guests are handled separately by the chat POST
 * route and are never allowed here — attachment upload and moderation both
 * require an authenticated member.
 *
 * Extracted so the chat POST route, the attachment upload route, and the
 * moderation route share one authoritative implementation instead of drifting.
 */

import { resolveGrantForEvent } from '@/lib/auth/moderator';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';

export interface ChatTokenSender {
  eventId: string;
  senderId: string;
  senderName: string;
  isModerator: boolean;
}

export interface ChatEventForAuth {
  id: string;
  moderatorToken: string;
  moderatorName?: string | null;
}

/**
 * Resolve a token to a non-guest sender, or null if the token matches no grant
 * or registration for this event. `displayNameOverride` is honoured ONLY for
 * the shared primary moderator link (mirrors the JWT displayName override);
 * per-row grants keep their authoritative decrypted name.
 */
export async function resolveTokenSender(
  event: ChatEventForAuth,
  token: string,
  displayNameOverride?: string,
): Promise<ChatTokenSender | null> {
  const grant = await resolveGrantForEvent(event, token);
  if (grant) {
    const isGrantModerator = grant.role === 'MODERATOR';
    const override = displayNameOverride?.trim();
    const senderName = grant.isPrimaryShared
      ? override || grant.displayName || 'Moderatore'
      : grant.displayName ?? 'Moderatore';
    return {
      eventId: event.id,
      senderId: grant.isPrimaryShared
        ? `mod-${event.id}-primary`
        : `${isGrantModerator ? 'mod' : 'spk'}-${event.id}-${grant.grantId}`,
      senderName,
      isModerator: isGrantModerator,
    };
  }

  const registration = await prisma.registration.findUnique({
    where: { accessToken: token },
    select: { id: true, displayName: true, eventId: true },
  });
  if (registration && registration.eventId === event.id) {
    return {
      eventId: event.id,
      senderId: `reg-${registration.id}`,
      senderName:
        tryDecryptPII(registration.displayName) ?? registration.displayName,
      isModerator: false,
    };
  }

  return null;
}
