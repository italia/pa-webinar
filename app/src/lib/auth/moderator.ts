import { createHash, timingSafeEqual } from 'crypto';

import { EventModeratorRole } from '@prisma/client';

import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { getCached, setCache, deleteCache } from '@/lib/cache';

export type GrantRole = EventModeratorRole;

export function constantTimeEqual(a: string, b: string): boolean {
  // Hash both inputs to a fixed-length digest so timingSafeEqual always
  // runs on equal-length buffers — removes the length-based timing oracle
  // from the previous implementation. SHA-256 collisions are infeasible,
  // so digest equality implies input equality.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

let warnedQueryToken = false;

/**
 * Extract the moderator token from the request.
 * Accepted locations (in priority order):
 *   1. Authorization: Bearer <token>  ← preferred for API calls.
 *   2. ?token=<token> query parameter ← legacy; kept for magic-link
 *      landing pages. New client-side fetches should use the header.
 *
 * When the token arrives via the query string we log a one-shot warning
 * so operators can spot deployments that still rely on URL-borne tokens
 * (visible to access logs, CDN logs, browser history, Referer header).
 */
export function extractModeratorToken(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken && !warnedQueryToken) {
    warnedQueryToken = true;
    console.warn(
      `[pa-webinar] Moderator/access token received via ?token= query ` +
        `parameter on ${url.pathname}. Prefer Authorization: Bearer for ` +
        `API calls — URL tokens leak to access logs and browser history.`,
    );
  }
  return queryToken;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verify a moderator token belongs to the given event and return the event.
 * Accepts either a UUID id or a slug for the event lookup.
 *
 * Two accepted tokens:
 *   - `Event.moderatorToken` (primary owner magic link, always valid)
 *   - `EventModerator.token` with role=MODERATOR (co-moderator magic
 *     link; must not be revoked and must reference the same event)
 *
 * SPEAKER-role grants are NOT accepted here — speakers don't have
 * moderation authority and must not pass moderator-only endpoints.
 * Use `verifyGrantToken` to resolve speaker tokens.
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

  // La regola di accettazione (primario o co-moderatore) vive SOLO in
  // isEventModerator: due copie di una regola security-sensitive divergono.
  return (await isEventModerator(event, token)) ? event : null;
}

/**
 * True se `token` autorizza la moderazione dell'evento GIÀ FETCHATO: il token
 * primario dell'owner, oppure un co-moderatore (EventModerator role=MODERATOR)
 * non revocato dello stesso evento. Variante di `verifyModeratorToken` che
 * evita il re-fetch quando il chiamante ha già l'evento in mano — usata dalle
 * route di conduzione live (sondaggi, Q&A, wordcloud, timer, chat, materiali).
 * Gli SPEAKER NON sono moderatori. Tollerante al token null/undefined.
 */
export async function isEventModerator(
  event: { id: string; moderatorToken: string },
  token: string | null | undefined,
): Promise<boolean> {
  if (!token) return false;
  if (constantTimeEqual(event.moderatorToken, token)) return true;
  const coMod = await prisma.eventModerator.findUnique({ where: { token } });
  return (
    !!coMod &&
    coMod.eventId === event.id &&
    coMod.revokedAt === null &&
    coMod.role === EventModeratorRole.MODERATOR
  );
}

/** TTL breve: un grant/revoca co-moderatore diventa effettivo sugli endpoint
 *  di polling entro questo intervallo. La revoca invalida comunque la chiave
 *  subito via invalidateModeratorCache (sul pod locale). */
const MODERATOR_CACHE_TTL_MS = 5_000;

function moderatorCacheKey(eventId: string, token: string): string {
  // Hash del token, mai il token in chiaro come chiave.
  return `comod:${eventId}:${createHash('sha256').update(token).digest('base64url')}`;
}

/**
 * Da chiamare alla revoca di un co-moderatore: butta l'esito cacheato per quel
 * token così le GET di polling smettono di accettarlo immediatamente invece
 * che entro il TTL. Best-effort in multi-replica (cache per-pod).
 */
export function invalidateModeratorCache(eventId: string, token: string): void {
  deleteCache(moderatorCacheKey(eventId, token));
}

/**
 * Variante di `isEventModerator` con cache TTL per le GET di polling
 * (Q&A, sondaggi: SWR ~3s per partecipante). Il confronto col token primario
 * resta in-process (mai cacheato); solo l'esito della lookup co-moderatore —
 * a miss garantito per ogni token partecipante — viene cacheato, così il
 * polling non aggiunge una query DB per richiesta proprio dove la cache
 * delle route esiste per toglierle. La chiave usa l'hash del token, mai il
 * token in chiaro.
 */
export async function isEventModeratorCached(
  event: { id: string; moderatorToken: string },
  token: string | null | undefined,
): Promise<boolean> {
  if (!token) return false;
  if (constantTimeEqual(event.moderatorToken, token)) return true;
  const key = moderatorCacheKey(event.id, token);
  const cached = getCached<boolean>(key);
  if (cached !== null) return cached;
  const result = await isEventModerator(event, token);
  setCache(key, result, MODERATOR_CACHE_TTL_MS);
  return result;
}

/**
 * Resolve any grant token (primary moderator, co-moderator, or speaker)
 * for an event. Returns the event + the grant's role and display name.
 *
 * Used by the /live entry point where moderators AND speakers both
 * arrive via magic link and need distinct Jitsi capabilities.
 */
export async function verifyGrantToken(
  eventIdOrSlug: string,
  token: string,
): Promise<
  | {
      event: Awaited<ReturnType<typeof prisma.event.findUnique>>;
      role: GrantRole;
      displayName: string | null;
      /** True for the SHARED primary `Event.moderatorToken` magic link.
       *  Callers must require a typed display-name override for this case —
       *  every moderator opening the shared link would otherwise collapse
       *  to the same generic event.moderatorName. Per-row grants
       *  (co-moderator / speaker) carry their own `displayName`. */
      isPrimaryShared: boolean;
    }
  | null
> {
  const where = UUID_RE.test(eventIdOrSlug)
    ? { id: eventIdOrSlug }
    : { slug: eventIdOrSlug };

  const event = await prisma.event.findUnique({ where });
  if (!event) return null;

  const grant = await resolveGrantForEvent(event, token);
  if (!grant) return null;

  return {
    event,
    role: grant.role,
    displayName: grant.displayName,
    isPrimaryShared: grant.isPrimaryShared,
  };
}

/**
 * Come `verifyGrantToken`, ma sull'evento GIÀ FETCHATO (evita il re-fetch)
 * e con in più l'id della riga grant. È l'UNICA implementazione della
 * risoluzione token→identità (primario condiviso / co-moderatore /
 * speaker), nome già decifrato: chat e /live non devono re-implementarla.
 */
export async function resolveGrantForEvent(
  event: { id: string; moderatorToken: string; moderatorName?: string | null },
  token: string,
): Promise<
  | {
      role: GrantRole;
      displayName: string | null;
      isPrimaryShared: boolean;
      /** EventModerator.id per i grant per-riga; null per il primario condiviso. */
      grantId: string | null;
    }
  | null
> {
  if (constantTimeEqual(event.moderatorToken, token)) {
    return {
      role: EventModeratorRole.MODERATOR,
      displayName: event.moderatorName ?? null,
      isPrimaryShared: true,
      grantId: null,
    };
  }

  const grant = await prisma.eventModerator.findUnique({ where: { token } });
  if (grant && grant.eventId === event.id && grant.revokedAt === null) {
    return {
      role: grant.role,
      displayName: tryDecryptPII(grant.name) ?? grant.name,
      isPrimaryShared: false,
      grantId: grant.id,
    };
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
    return tryDecryptPII(coMod.name) ?? coMod.name;
  }

  return null;
}

export { EventModeratorRole };
