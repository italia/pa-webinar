import { createHash } from 'crypto';

/**
 * Gravatar URL for an email address, or null.
 *
 * Only ever called when the admin has switched it on: the URL embeds a hash of
 * the attendee's email, Jitsi broadcasts the avatar URL to everyone in the room
 * via presence, and each render is a request to a third party. That is a
 * decision for the organisation to take (and to declare in its privacy notice),
 * not a default.
 *
 * SHA-256 rather than the legacy MD5 — Gravatar supports both and there is no
 * reason to ship MD5 in 2026. `d=identicon` because the alternative is a broken
 * image: Gravatar cannot fall back to the initials avatar we generate ourselves,
 * so an address with no picture gets a deterministic geometric one instead.
 */
export function gravatarUrl(email: string | undefined, size = 200): string | null {
  const normalised = (email ?? '').trim().toLowerCase();
  if (!normalised || !normalised.includes('@')) return null;
  const hash = createHash('sha256').update(normalised).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon`;
}
