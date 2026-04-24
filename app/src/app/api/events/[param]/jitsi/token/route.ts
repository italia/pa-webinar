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
import { jitsiTokenRequestSchema } from '@/lib/validation/schemas';
import { EventModeratorRole, verifyGrantToken } from '@/lib/auth/moderator';
import {
  generateJitsiJwt,
  moderatorJitsiId,
  participantJitsiId,
  guestJitsiId,
} from '@/lib/auth/jwt';
import { decryptPII } from '@/lib/crypto/pii';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

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
    const fallbackName = isSpeaker ? 'Relatore' : 'Moderatore';
    const name = displayNameOverride || grant.displayName || fallbackName;

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: name,
      uniqueId: moderatorJitsiId(event.id),
      isModerator: !isSpeaker,
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

    if (!registration.joinedAt) {
      await prisma.registration.update({
        where: { id: registration.id },
        data: { joinedAt: new Date() },
      });
    }

    const name = registration.displayName;
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
