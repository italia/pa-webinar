import { timingSafeEqual } from 'crypto';

import { prisma } from '@/lib/db';

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Extract the moderator token from the request.
 * Accepted locations (in priority order):
 *   1. Authorization: Bearer <token>
 *   2. ?token=<token> query parameter
 */
export function extractModeratorToken(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  const url = new URL(request.url);
  return url.searchParams.get('token');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verify a moderator token belongs to the given event and return the event.
 * Accepts either a UUID id or a slug for the event lookup.
 *
 * Two accepted tokens:
 *   - `Event.moderatorToken` (primary owner magic link, always valid)
 *   - `EventModerator.token` (co-moderator magic link; must not be
 *     revoked and must reference the same event)
 *
 * Returns null if no match.
 */
export async function verifyModeratorToken(
  eventIdOrSlug: string,
  token: string,
) {
  const where = UUID_RE.test(eventIdOrSlug)
    ? { id: eventIdOrSlug }
    : { slug: eventIdOrSlug };

  const event = await prisma.event.findUnique({ where });
  if (!event) return null;

  if (constantTimeEqual(event.moderatorToken, token)) {
    return event;
  }

  // Co-moderator path: lookup by token, then cross-check that it points
  // at the same event and hasn't been revoked.
  const coMod = await prisma.eventModerator.findUnique({ where: { token } });
  if (coMod && coMod.eventId === event.id && coMod.revokedAt === null) {
    return event;
  }

  return null;
}

/**
 * Resolve a moderator token to its human-readable display name.
 * Returns the Event's primary moderator name for the primary token,
 * the co-moderator's own name for a secondary token, or null when no
 * match (caller decides fallback — usually the pre-join input).
 */
export async function resolveModeratorName(
  eventIdOrSlug: string,
  token: string,
): Promise<string | null> {
  const where = UUID_RE.test(eventIdOrSlug)
    ? { id: eventIdOrSlug }
    : { slug: eventIdOrSlug };

  const event = await prisma.event.findUnique({ where });
  if (!event) return null;

  if (constantTimeEqual(event.moderatorToken, token)) {
    return event.moderatorName ?? null;
  }

  const coMod = await prisma.eventModerator.findUnique({ where: { token } });
  if (coMod && coMod.eventId === event.id && coMod.revokedAt === null) {
    return coMod.name;
  }

  return null;
}
