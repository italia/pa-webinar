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
 * Returns null if the token is invalid or doesn't match.
 */
export async function verifyModeratorToken(
  eventIdOrSlug: string,
  token: string,
) {
  const where = UUID_RE.test(eventIdOrSlug)
    ? { id: eventIdOrSlug }
    : { slug: eventIdOrSlug };

  const event = await prisma.event.findUnique({ where });

  if (!event || !constantTimeEqual(event.moderatorToken, token)) {
    return null;
  }

  return event;
}
