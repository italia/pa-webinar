import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { jitsiTokenRequestSchema } from '@/lib/validation/schemas';
import {
  generateJitsiJwt,
  moderatorJitsiId,
  participantJitsiId,
  guestJitsiId,
} from '@/lib/auth/jwt';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { param: slug } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = jitsiTokenRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { accessToken, moderatorToken, guestName, displayNameOverride } = parsed.data;

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  if (!['PUBLISHED', 'LIVE'].includes(event.status)) {
    return NextResponse.json(
      { error: 'Event is not active' },
      { status: 409 },
    );
  }

  // ── Moderator flow ──
  if (moderatorToken) {
    if (event.moderatorToken !== moderatorToken) {
      return NextResponse.json({ error: 'Invalid moderator token' }, { status: 403 });
    }

    const name = displayNameOverride || event.moderatorName || 'Moderatore';

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: name,
      uniqueId: moderatorJitsiId(event.id),
      isModerator: true,
    });

    return NextResponse.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: name,
      role: 'moderator',
    });
  }

  // ── Participant flow ──
  if (accessToken) {
    const registration = await prisma.registration.findUnique({
      where: { accessToken },
    });

    if (!registration || registration.eventId !== event.id) {
      return NextResponse.json({ error: 'Invalid access token' }, { status: 403 });
    }

    if (!registration.joinedAt) {
      await prisma.registration.update({
        where: { id: registration.id },
        data: { joinedAt: new Date() },
      });
    }

    const name = displayNameOverride || registration.displayName;

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: name,
      uniqueId: participantJitsiId(registration.id),
      isModerator: false,
    });

    return NextResponse.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: name,
      role: 'participant',
    });
  }

  // ── Guest flow (no registration, LIVE events only) ──
  if (guestName) {
    if (event.status !== 'LIVE') {
      return NextResponse.json(
        { error: 'Guest access is only available during live events' },
        { status: 409 },
      );
    }

    const ip = getClientIp(request);
    const rl = rateLimit(`guest-jwt:${ip}`, { limit: 5, windowMs: 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      );
    }

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: guestName,
      uniqueId: guestJitsiId(),
      isModerator: false,
      expiresInSeconds: 2 * 60 * 60,
    });

    return NextResponse.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: guestName,
      role: 'guest',
    });
  }

  return NextResponse.json({ error: 'No token provided' }, { status: 400 });
}
