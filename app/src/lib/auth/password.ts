import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Opt-in join password hashing for events. Used by the "private
 * instant call" flow: admin sets a password, guests must type it before
 * the Jitsi JWT is issued.
 *
 * We avoid pulling in bcrypt (needs a native build) by relying on the
 * Node crypto stdlib. scrypt with a 16-byte random salt and a 64-byte
 * derived key is sufficient for the threat model here — these passwords
 * guard a short-lived video room, not a long-term user credential.
 *
 * Hash format: `scrypt:$saltHex:$keyHex` (both hex-encoded, `:`
 * separated). The prefix lets us rotate to a different algorithm later
 * without migrating existing rows.
 */

const ALGO = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export function hashJoinPassword(plaintext: string): string {
  if (!plaintext || plaintext.length < 4) {
    throw new Error('Join password must be at least 4 characters');
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(plaintext, salt, KEY_BYTES);
  return `${ALGO}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyJoinPassword(plaintext: string, hash: string): boolean {
  if (!plaintext || !hash) return false;
  const parts = hash.split(':');
  if (parts.length !== 3 || parts[0] !== ALGO || !parts[1] || !parts[2]) {
    return false;
  }
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const key = Buffer.from(parts[2], 'hex');
    const candidate = scryptSync(plaintext, salt, key.length);
    return timingSafeEqual(key, candidate);
  } catch {
    return false;
  }
}
