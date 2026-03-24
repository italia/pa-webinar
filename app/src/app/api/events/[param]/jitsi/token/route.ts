import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { jitsiTokenRequestSchema } from '@/lib/validation/schemas';
import { generateJitsiJwt } from '@/lib/auth/jwt';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string }>;
}

// ── POST /api/events/[slug]/jitsi/token ──────────────────────

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

  const { accessToken, moderatorToken } = parsed.data;

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

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: event.moderatorName ?? 'Moderatore',
      email: event.moderatorEmail ?? `mod@${event.slug}`,
      isModerator: true,
    });

    return NextResponse.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: event.moderatorName ?? 'Moderatore',
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

    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: registration.displayName,
      email: registration.emailHash,
      isModerator: false,
    });

    return NextResponse.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: registration.displayName,
      role: 'participant',
    });
  }

  return NextResponse.json({ error: 'No token provided' }, { status: 400 });
}
