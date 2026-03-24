import { prisma } from '@/lib/db';

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

/**
 * Verify a moderator token belongs to the given event and return the event.
 * Returns null if the token is invalid or doesn't match.
 */
export async function verifyModeratorToken(
  eventId: string,
  token: string,
) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
  });

  if (!event || event.moderatorToken !== token) {
    return null;
  }

  return event;
}
