/**
 * Join-password grant cookie.
 *
 * An event may be protected by a join password (`Event.joinPasswordHash`).
 * `POST /api/events/:param/verify-password` checks it and sets a signed
 * `join_granted_<eventId>` cookie; every surface that would otherwise let an
 * anonymous visitor reach protected content must require that grant.
 *
 * Extracted from the live page so the chat read gate enforces the SAME rule:
 * without it, someone who has the URL but not the password could not enter the
 * room, yet could still fetch the room's chat transcript — names included.
 */

import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';

/** True when the caller holds a valid join grant for this event. */
export async function hasJoinGrant(eventId: string): Promise<boolean> {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) return false;
  const cookieStore = await cookies();
  const cookie = cookieStore.get(`join_granted_${eventId}`)?.value;
  if (!cookie) return false;
  try {
    const secret = new TextEncoder().encode(appSecret);
    const { payload } = await jwtVerify(cookie, secret);
    return payload.eventId === eventId;
  } catch {
    return false;
  }
}
