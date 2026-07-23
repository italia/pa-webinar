/**
 * Shared resolution of a chat sender from a token (the NON-guest paths:
 * moderator primary link, per-row co-moderator/speaker grant, or a registered
 * participant's accessToken). Guests are handled separately by the chat POST
 * route and are never allowed here — attachment upload and moderation both
 * require an authenticated member.
 *
 * Extracted so the chat POST route, the attachment upload route, and the
 * moderation route share one authoritative implementation instead of drifting.
 *
 * F7 identity binding is baked in here (not left to each caller) so no surface
 * can forget it: a registration accessToken is named from the registrant's
 * authoritative decrypted DB name ONLY on the browser that registered (holds
 * the signed event_access cookie). A forwarded personal link opened elsewhere
 * keeps the same registration seat but is named from what the opener typed, so
 * the registrant's real name is never auto-attributed to someone else.
 */

import { resolveGrantForEvent } from '@/lib/auth/moderator';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { readOwnedEventAccessToken } from '@/lib/event-session';

export interface ChatTokenSender {
  eventId: string;
  senderId: string;
  senderName: string;
  isModerator: boolean;
  /**
   * True only when this token identifies ONE person.
   *
   * `senderId` deliberately is NOT that: the shared primary moderator link
   * resolves to `mod-<eventId>-primary` for everyone who holds it, and a
   * forwarded registration link keeps the SAME `reg-<id>` seat (F7, on purpose —
   * it keeps a legitimate cross-device registrant from splitting in two). Those
   * are seats, not people. Anything that authorises acting AS the author — such
   * as editing a message after the fact — must require this flag instead, or one
   * holder of a shared link can rewrite another's words under their name.
   */
  isPerPersonIdentity: boolean;
}

export interface ChatEventForAuth {
  id: string;
  moderatorToken: string;
  moderatorName?: string | null;
}

/**
 * Resolve a token to a non-guest sender, or null if the token matches no grant
 * or registration for this event.
 *
 * `displayNameOverride` is a client-typed name. It is honoured for the shared
 * primary moderator link (mirrors the JWT displayName override) and as the name
 * of a NON-owning registration-link opener (F7); per-row grants and the owning
 * registrant keep their authoritative decrypted name.
 *
 * Must be called within a request scope — the F7 ownership check reads the
 * event_access cookie via next/headers.
 */
export async function resolveTokenSender(
  event: ChatEventForAuth,
  token: string,
  displayNameOverride?: string,
): Promise<ChatTokenSender | null> {
  const grant = await resolveGrantForEvent(event, token);
  if (grant) {
    // Grant magic links carry no event_access cookie — never touch the cookie
    // for them (keeps the moderator hot path off an HS256 verify).
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
      // A per-ROW grant is issued to one named person; the shared primary link
      // is handed around a team.
      isPerPersonIdentity: !grant.isPrimaryShared,
    };
  }

  const registration = await prisma.registration.findUnique({
    where: { accessToken: token },
    select: { id: true, displayName: true, eventId: true },
  });
  if (registration && registration.eventId === event.id) {
    // F7 gate (read the cookie only now that a registration matched, so grants
    // never pay for it): surface the registrant's authoritative decrypted DB
    // name ONLY to the browser that registered (owns the event_access cookie).
    // A forwarded personal link opened elsewhere keeps the SAME registration
    // seat (reg-<id>) but is named from what the opener TYPED — never the
    // registrant's real name auto-decrypted from the DB.
    //
    // The seat id is deliberately unchanged from the pre-F7 behaviour: chat has
    // always keyed a registration token to reg-<id> (rate-limit + analytics), so
    // a legitimate cross-device / cookieless registrant still merges with their
    // own Q&A/poll activity instead of splitting into a second analytics identity.
    const owns = (await readOwnedEventAccessToken(event.id)) === token;
    return {
      eventId: event.id,
      senderId: `reg-${registration.id}`,
      senderName: owns
        ? (tryDecryptPII(registration.displayName) ?? registration.displayName)
        : displayNameOverride?.trim() || 'Partecipante',
      isModerator: false,
      // Only the browser that registered — the one holding the signed
      // event_access cookie — is provably this person. A forwarded link shares
      // the seat, which is fine for attribution and wrong for authorship.
      isPerPersonIdentity: owns,
    };
  }

  return null;
}
