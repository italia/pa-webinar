/**
 * The only reference to a Gravatar that is allowed to travel in a Jitsi JWT.
 *
 * Two constraints meet here, and neither is negotiable:
 *
 *   • ADR-004 says the JWT carries "email hash (not email)", so that "Jitsi
 *     never sees PII directly". Jitsi broadcasts `context.user.avatar` in
 *     presence to EVERY participant in the room, so whatever goes in the avatar
 *     URL is effectively published to the audience. An earlier attempt put
 *     `encryptPII(email)` there: safe against outsiders, but still the address
 *     itself, which is exactly what the ADR forbids.
 *   • Gravatar's protocol needs the MD5 of the lowercased address — nothing
 *     else resolves an avatar — so the hash cannot be replaced with a stronger
 *     digest. MD5 is used here as an identifier, never as a security control.
 *
 * The answer is both: hash first (ADR-004 satisfied), then encrypt the hash
 * with our PII key. A bare MD5 of an address in front of a room would be a
 * re-identification oracle — addresses carry far too little entropy, so any
 * attendee could test `nome.cognome@comune.it` against everyone else present.
 * Wrapped in AES-GCM it reveals nothing, and only this server can undo it.
 */

import { createHash } from 'crypto';

import { decryptPII, encryptPII } from '@/lib/crypto/pii';

/** MD5 of the normalised address — Gravatar's own identifier format. */
export function gravatarHash(email: string): string | null {
  const normalised = email.trim().toLowerCase();
  if (!normalised.includes('@')) return null;
  return createHash('md5').update(normalised).digest('hex');
}

/** The opaque value carried in `/api/avatar?g=…`. Null for a junk address. */
export function gravatarRef(email: string): string | null {
  const hash = gravatarHash(email);
  return hash ? encryptPII(hash) : null;
}

/** Undo `gravatarRef`. Null when tampered with, stale, or not a hash. */
export function readGravatarRef(ref: string): string | null {
  try {
    const hash = decryptPII(ref);
    return /^[0-9a-f]{32}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}
