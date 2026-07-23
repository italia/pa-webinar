import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  ValidationError,
  AppError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { jitsiTokenRequestSchema } from '@/lib/validation/schemas';
import { EventModeratorRole, verifyGrantToken } from '@/lib/auth/moderator';
import {
  generateJitsiJwt,
  moderatorJitsiId,
  participantJitsiId,
  guestJitsiId,
} from '@/lib/auth/jwt';
import { decryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { cookies } from 'next/headers';
import { verifyEventAccess, eventAccessCookieName } from '@/lib/event-session';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const body = await parseJsonBody(request);
  const parsed = jitsiTokenRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const { accessToken, moderatorToken, guestName, displayNameOverride } = parsed.data;

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  // JWT is minted only when the bridge is ready (LIVE) or the event is still
  // in the pre-start window (PUBLISHED). For PROVISIONING/IDLE the frontend
  // must first transition through the ProvisioningScreen; handing out a JWT
  // now would drop the user on a cold JVB.
  if (!['PUBLISHED', 'LIVE'].includes(event.status)) {
    throw new ConflictError('Event is not active', { currentStatus: event.status });
  }

  // ── Grant flow (primary moderator, co-moderator, or speaker) ──
  if (moderatorToken) {
    const grant = await verifyGrantToken(event.slug, moderatorToken);
    if (!grant) {
      throw new ForbiddenError('Invalid moderator token');
    }

    const isSpeaker = grant.role === EventModeratorRole.SPEAKER;

    // The PRIMARY moderator magic link is SHARED: every moderator opening
    // it would otherwise mint a JWT under the same generic
    // event.moderatorName ("Moderatore"), so they all collapse into one
    // identity in chat / the participant list. Require the client-supplied
    // name (the waiting room forces it) instead of silently falling back.
    // Per-row grants (named co-moderator / speaker) keep their own
    // decrypted grant.displayName.
    const trimmedOverride = displayNameOverride?.trim();
    let name: string;
    if (grant.isPrimaryShared) {
      if (!trimmedOverride) {
        throw new ValidationError('Display name is required for moderators');
      }
      name = trimmedOverride;
    } else {
      name = trimmedOverride || grant.displayName || (isSpeaker ? 'Relatore' : 'Moderatore');
    }

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: name,
      uniqueId: moderatorJitsiId(event.id),
      isModerator: !isSpeaker,
      // Chi sta sullo schermo è soprattutto chi modera e chi parla: se l'avatar
      // Gravatar valesse solo per il pubblico, la funzione si vedrebbe dove
      // conta meno. `grant.email` è null per il link primario — condiviso da
      // tutto il team, nessuna persona dietro — e lì restano le iniziali.
      email: grant.email ?? undefined,
      useGravatar: (await getSettings()).gravatarEnabled,
    });

    return Response.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: name,
      role: isSpeaker ? 'speaker' : 'moderator',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // ── Participant flow ──
  if (accessToken) {
    const registration = await prisma.registration.findUnique({
      where: { accessToken },
    });

    if (!registration || registration.eventId !== event.id) {
      throw new ForbiddenError('Invalid access token');
    }

    // The accessToken lives in the personal join link, so a FORWARDED link would
    // otherwise let the opener mint the registrant's identity (F7). Bind identity
    // to the browser that registered: the signed `event_access` cookie must carry
    // this same token. A non-owner still gets in (possessing the shared token
    // authorizes entry), but under THEIR OWN typed name and a fresh guest
    // identity — never the registrant's name, slot, or recording consent.
    const cookieStore = await cookies();
    const ownsToken =
      (await verifyEventAccess(
        event.id,
        cookieStore.get(eventAccessCookieName(event.id))?.value,
      )) === accessToken;

    if (!ownsToken) {
      const typedName = displayNameOverride?.trim();
      if (!typedName) {
        throw new ValidationError('Display name is required');
      }
      // This branch mints a GUEST JWT (fresh identity), so rate-limit it per IP
      // exactly like the pure-guest path below — a forwarded link shouldn't be a
      // faster route to bulk JWT minting than an anonymous one.
      const ip = getClientIp(request);
      const limit = parseInt(process.env.GUEST_JWT_RATE_LIMIT_PER_MINUTE || '120', 10);
      const rl = rateLimit(`guest-jwt:${ip}`, { limit, windowMs: 60_000 });
      if (!rl.allowed) {
        throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
      }
      const guestJwt = await generateJitsiJwt({
        roomName: event.jitsiRoomName,
        displayName: typedName,
        uniqueId: guestJitsiId(),
        isModerator: false,
        expiresInSeconds: 2 * 60 * 60,
      });
      return Response.json(
        {
          jwt: guestJwt,
          roomName: event.jitsiRoomName,
          displayName: typedName,
          role: 'participant',
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Record the join, set-once. Kept write-free on rejoin so the reconnect
    // path never depends on a DB write (a write failure here would 500 the
    // token fetch and eject a reconnecting participant). leftAt is best-effort
    // and may be stale after a rejoin — the retention signal tolerates that via
    // its minimum-sample guard.
    if (!registration.joinedAt) {
      await prisma.registration.update({
        where: { id: registration.id },
        data: { joinedAt: new Date() },
      });
    }

    const name = tryDecryptPII(registration.displayName) ?? registration.displayName;
    let email: string | undefined;
    try {
      email = decryptPII(registration.email);
    } catch {
      // PII decryption failure — skip Gravatar, use SVG fallback
    }

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: name,
      uniqueId: participantJitsiId(registration.id),
      isModerator: false,
      email,
      // La scelta è dell'amministratore, e la legge il chiamante: il minter del
      // token resta puro (vedi JitsiTokenPayload.useGravatar).
      useGravatar: (await getSettings()).gravatarEnabled,
    });

    return Response.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: name,
      role: 'participant',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // ── Guest flow (no registration, LIVE events only) ──
  if (guestName) {
    if (event.status !== 'LIVE') {
      throw new ConflictError('Guest access is only available during live events');
    }

    // Default 120/min per IP to accommodate bursts of participants joining
    // from a shared corporate NAT (common scenario: announcing the link
    // during an MS Teams call where 100+ colleagues click simultaneously).
    // Tunable per-deploy via GUEST_JWT_RATE_LIMIT_PER_MINUTE; the in-memory
    // limiter is per-pod, so the effective ceiling is N_replicas × limit.
    const ip = getClientIp(request);
    const limit = parseInt(process.env.GUEST_JWT_RATE_LIMIT_PER_MINUTE || '120', 10);
    const rl = rateLimit(`guest-jwt:${ip}`, { limit, windowMs: 60_000 });
    if (!rl.allowed) {
      throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
    }

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: guestName,
      uniqueId: guestJitsiId(),
      isModerator: false,
      expiresInSeconds: 2 * 60 * 60,
    });

    return Response.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: guestName,
      role: 'guest',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  throw new AppError('No token provided', 400, 'BAD_REQUEST');
});
