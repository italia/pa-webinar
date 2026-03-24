/**
 * Authentication utilities for eventi-dtd.
 *
 * Two authentication flows:
 * 1. Moderators: magic link with UUID token → validates against Event.moderatorToken
 * 2. Participants: registration access token → validates against Registration.accessToken
 *
 * Both flows generate a Jitsi JWT for the actual video conference.
 */

import { createHash } from 'crypto';

import { SignJWT } from 'jose';

import type { JitsiJwtFeatures } from '@/lib/jitsi/config';
import { moderatorFeatures, participantFeatures } from '@/lib/jitsi/config';

const JITSI_JWT_SECRET = new TextEncoder().encode(
  process.env.JITSI_JWT_SECRET ?? ''
);
const JITSI_JWT_APP_ID = process.env.JITSI_JWT_APP_ID ?? 'eventi_dtd';
const JITSI_JWT_ISSUER = process.env.JITSI_JWT_ISSUER ?? 'eventi-dtd';
const JITSI_JWT_AUDIENCE = process.env.JITSI_JWT_AUDIENCE ?? 'jitsi';

interface JitsiTokenPayload {
  roomName: string;
  displayName: string;
  email: string;
  isModerator: boolean;
  expiresInSeconds?: number;
}

/**
 * Generate a Jitsi JWT for authenticating a user to a specific room.
 */
export async function generateJitsiJwt(
  payload: JitsiTokenPayload
): Promise<string> {
  const emailHash = hashEmail(payload.email);
  const features: JitsiJwtFeatures = payload.isModerator
    ? moderatorFeatures
    : participantFeatures;

  const jwt = await new SignJWT({
    context: {
      user: {
        name: payload.displayName,
        id: emailHash,
        moderator: payload.isModerator,
      },
      features,
    },
    room: payload.roomName,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(JITSI_JWT_APP_ID)
    .setIssuer(JITSI_JWT_ISSUER)
    .setAudience(JITSI_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(
      `${payload.expiresInSeconds ?? 4 * 60 * 60}s` // Default 4 hours
    )
    .sign(JITSI_JWT_SECRET);

  return jwt;
}

/**
 * Hash an email for use in Jitsi JWT (avoids exposing PII).
 */
export function hashEmail(email: string): string {
  return createHash('sha256')
    .update(email.toLowerCase().trim())
    .digest('hex');
}

/**
 * Generate a secure random token for moderator magic links.
 * Uses crypto.randomUUID() which is available in Node.js 19+.
 */
export function generateModeratorToken(): string {
  return crypto.randomUUID();
}

/**
 * Generate a short access token for participant join links.
 * Uses nanoid for URL-safe, collision-resistant IDs.
 */
export async function generateAccessToken(): Promise<string> {
  const { nanoid } = await import('nanoid');
  return nanoid(24);
}
