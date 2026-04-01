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
import { constantTimeEqual } from '@/lib/auth/moderator';
import {
  generateJitsiJwt,
  moderatorJitsiId,
  participantJitsiId,
  guestJitsiId,
} from '@/lib/auth/jwt';
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

  if (!['PUBLISHED', 'LIVE'].includes(event.status)) {
    throw new ConflictError('Event is not active');
  }

  // ── Moderator flow ──
  if (moderatorToken) {
    if (!constantTimeEqual(event.moderatorToken, moderatorToken)) {
      throw new ForbiddenError('Invalid moderator token');
    }

    const name = displayNameOverride || event.moderatorName || 'Moderatore';

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: name,
      uniqueId: moderatorJitsiId(event.id),
      isModerator: true,
    });

    return Response.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: name,
      role: 'moderator',
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

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: name,
      uniqueId: participantJitsiId(registration.id),
      isModerator: false,
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

    const ip = getClientIp(request);
    const rl = rateLimit(`guest-jwt:${ip}`, { limit: 5, windowMs: 60_000 });
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
