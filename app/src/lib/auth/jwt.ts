/**
 * Authentication utilities for pa-webinar.
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
  return process.env.JITSI_JWT_APP_ID ?? 'pa_webinar';
}

function getJitsiJwtIssuer(): string {
  return process.env.JITSI_JWT_ISSUER ?? 'pa-webinar';
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

import { generateAvatarDataUri } from '@/lib/avatar';
import { getPublicEnv } from '@/lib/env';
import { gravatarRef } from '@/lib/gravatar-ref';

interface JitsiTokenPayload {
  roomName: string;
  displayName: string;
  /** Globally unique identifier for this Jitsi session. */
  uniqueId: string;
  isModerator: boolean;
  expiresInSeconds?: number;
  /** Usata per l'avatar solo quando `useGravatar` è true (vedi sotto). */
  email?: string;
  /**
   * Quando true l'avatar punta al NOSTRO proxy `/api/avatar`, che interroga
   * Gravatar lato server e ricade sull'SVG con le iniziali. La decisione arriva
   * dal chiamante, che ha già i settings: leggerli qui accoppierebbe ogni
   * emissione di token — cron del recorder compreso — alle impostazioni del
   * sito, e renderebbe impuri gli unit test di questo modulo.
   */
  useGravatar?: boolean;
}

/** L'origin pubblico dell'app, o null se non è un URL http(s) assoluto (nel
 *  qual caso l'avatar resta il data URI invece di diventare un link rotto). */
function absoluteAppUrl(): string | null {
  try {
    const url = new URL(getPublicEnv('NEXT_PUBLIC_APP_URL'));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * Default TTL for the Jitsi JWT. Even moderators are kept at 2h: a
 * leaked moderator token grants full room control until expiry and
 * Jitsi has no native jti blacklist, so the TTL is our only revocation
 * lever. Most live events run 60–90 min — moderators that need to
 * stay longer can rejoin via the magic link to mint a fresh token.
 * Participants get the tighter 90-min window already pegged to the
 * room lifecycle.
 */
const MODERATOR_JWT_TTL_SECONDS = 2 * 60 * 60;
const PARTICIPANT_JWT_TTL_SECONDS = 90 * 60;

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

  // Di norma un data URI SVG inline: attraversa qualunque restrizione del web
  // Jitsi e non fa partire richieste.
  //
  // Con Gravatar attivo puntiamo al NOSTRO proxy `/api/avatar`, mai a
  // gravatar.com: è il nostro server a parlare col terzo, non il browser dei
  // partecipanti, e `docs/GDPR.md` resta vero. Quello che viaggia nell'URL è
  // l'hash dell'email, cifrato — mai l'indirizzo: vedi `lib/gravatar-ref`.
  //
  // `getPublicEnv` e non `process.env.NEXT_PUBLIC_*`: la seconda forma viene
  // SOSTITUITA a build time da webpack, e l'immagine è costruita con
  // `ARG NEXT_PUBLIC_APP_URL=http://localhost:3000` — in produzione ogni avatar
  // avrebbe puntato al localhost di chi guarda.
  //
  // Se il proxy non è raggiungibile resta il data URI: `d=404` lato proxy fa
  // ricadere sulle iniziali chi non ha un Gravatar, quindi l'unico scenario
  // scoperto è l'URL remoto in sé — ed è per questo che l'opzione è opt-in.
  let avatarUrl = generateAvatarDataUri(payload.displayName);
  if (payload.useGravatar && payload.email) {
    const base = absoluteAppUrl();
    const ref = gravatarRef(payload.email);
    if (base && ref) {
      const q = new URLSearchParams({
        name: payload.displayName,
        g: ref,
        size: '200',
      });
      avatarUrl = `${base}/api/avatar?${q.toString()}`;
    }
  }

  const jwt = await new SignJWT({
    context: {
      user: {
        // `name` is the canonical Jitsi field (read by Prosody token
        // plugin and lib-jitsi-meet for displayName). We also set
        // `displayName` for older Jitsi forks / token modules that
        // look at that field instead. Keeping both costs nothing and
        // avoids surprises when Prosody is upgraded.
        name: payload.displayName,
        displayName: payload.displayName,
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
      `${
        payload.expiresInSeconds ??
        (payload.isModerator
          ? MODERATOR_JWT_TTL_SECONDS
          : PARTICIPANT_JWT_TTL_SECONDS)
      }s`,
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
