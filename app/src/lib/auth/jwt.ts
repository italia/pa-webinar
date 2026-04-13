/**
 * Authentication utilities for eventi-dtd.
 *
 * Two authentication flows:
 * 1. Moderators: magic link with UUID token → validates against Event.moderatorToken
 * 2. Participants: registration access token → validates against Registration.accessToken
 *
 * Both flows generate a Jitsi JWT for the actual video conference.
 */

import { randomUUID } from 'crypto';

import { SignJWT } from 'jose';

import type { JitsiJwtFeatures } from '@/lib/jitsi/config';
import { moderatorFeatures, participantFeatures } from '@/lib/jitsi/config';

function getJitsiJwtSecret(): Uint8Array {
  const secret = process.env.JITSI_JWT_SECRET;
  if (!secret) {
    throw new Error('JITSI_JWT_SECRET environment variable is required');
  }
  return new TextEncoder().encode(secret);
}

function getJitsiJwtAppId(): string {
  return process.env.JITSI_JWT_APP_ID ?? 'eventi_dtd';
}

function getJitsiJwtIssuer(): string {
  return process.env.JITSI_JWT_ISSUER ?? 'eventi-dtd';
}

function getJitsiJwtAudience(): string {
  return process.env.JITSI_JWT_AUDIENCE ?? 'jitsi';
}

function getJitsiJwtSubject(): string {
  return (
    process.env.JITSI_JWT_SUBJECT ??
    process.env.NEXT_PUBLIC_JITSI_DOMAIN ??
    'localhost:8443'
  );
}

import { createHash } from 'crypto';

import { getPublicEnv } from '@/lib/env';

function getAppUrl(): string {
  return getPublicEnv('NEXT_PUBLIC_APP_URL');
}

function gravatarMd5(email: string): string {
  return createHash('md5').update(email.toLowerCase().trim()).digest('hex');
}

interface JitsiTokenPayload {
  roomName: string;
  displayName: string;
  /** Globally unique identifier for this Jitsi session. */
  uniqueId: string;
  isModerator: boolean;
  expiresInSeconds?: number;
  /** If provided, enables Gravatar lookup in the avatar proxy. */
  email?: string;
}

/**
 * Generate a Jitsi JWT for authenticating a user to a specific room.
 *
 * `uniqueId` MUST be different for every session/user so Jitsi treats
 * each connection as a distinct participant.
 */
export async function generateJitsiJwt(
  payload: JitsiTokenPayload
): Promise<string> {
  const features: JitsiJwtFeatures = payload.isModerator
    ? moderatorFeatures
    : participantFeatures;
  const jitsiJwtAppId = getJitsiJwtAppId();
  const jitsiJwtIssuer = getJitsiJwtIssuer();
  const jitsiJwtAudience = getJitsiJwtAudience();
  const jitsiJwtSubject = getJitsiJwtSubject();

  const avatarParams = new URLSearchParams({
    name: payload.displayName,
    size: '200',
    ...(payload.email ? { gh: gravatarMd5(payload.email) } : {}),
  });
  const avatarUrl = `${getAppUrl()}/api/avatar?${avatarParams.toString()}`;

  const jwt = await new SignJWT({
    context: {
      user: {
        name: payload.displayName,
        id: payload.uniqueId,
        avatar: avatarUrl,
        affiliation: payload.isModerator ? 'owner' : 'member',
        moderator: payload.isModerator ? 'true' : 'false',
      },
      features,
    },
    moderator: payload.isModerator,
    affiliation: payload.isModerator ? 'owner' : 'member',
    room: payload.roomName,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(jitsiJwtSubject)
    .setIssuer(jitsiJwtIssuer)
    .setAudience(jitsiJwtAudience)
    .setJti(`${jitsiJwtAppId}:${payload.uniqueId}`)
    .setIssuedAt()
    .setExpirationTime(
      `${payload.expiresInSeconds ?? 4 * 60 * 60}s`
    )
    .sign(getJitsiJwtSecret());

  return jwt;
}

/**
 * Generate a unique Jitsi participant ID for a moderator session.
 * Each call produces a different ID so multiple moderator tabs are
 * treated as separate participants.
 */
export function moderatorJitsiId(eventId: string): string {
  return `mod-${eventId}-${randomUUID().slice(0, 8)}`;
}

/**
 * Generate a unique Jitsi participant ID for a registered participant.
 * Uses the registration ID (already unique per event) plus a short
 * random suffix so re-joining creates a fresh participant slot.
 */
export function participantJitsiId(registrationId: string): string {
  return `reg-${registrationId}-${randomUUID().slice(0, 8)}`;
}

/**
 * Generate a unique Jitsi participant ID for a guest.
 */
export function guestJitsiId(): string {
  return `guest-${randomUUID()}`;
}

// Re-export hashEmail from the canonical location for convenience
export { hashEmail } from '@/lib/crypto/pii';

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
