import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { extractModeratorToken, verifyGrantToken } from '@/lib/auth/moderator';

// Generous absolute ceiling for a client-reported peak: bounds a spoofed value
// without under-counting real events (a single Jitsi bridge tops out well below
// this). We deliberately do NOT clamp to maxParticipants — moderators, speakers
// and guests legitimately join beyond the registration cap.
const PEAK_HARD_CAP = 2000;

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function eventWhereClause(param: string) {
  return UUID_RE.test(param)
    ? { OR: [{ id: param }, { slug: param }] }
    : { slug: param };
}

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) {
    throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const event = await prisma.event.findFirst({
    where: {
      ...eventWhereClause(param),
      moderatorToken: token,
    },
    select: { peakParticipants: true, status: true },
  });

  if (!event) {
    throw new AppError('Event not found', 404, 'NOT_FOUND');
  }

  return NextResponse.json({
    peakParticipants: event.peakParticipants,
    isLive: event.status === 'LIVE',
  });
});

const peakSchema = z
  .object({
    count: z.number().int().min(0),
    // Any authenticated attendee of THIS event may report the live count so the
    // peak isn't stuck at 0 in a moderator-less session (feedback #4b): a
    // moderator/co-moderator/speaker grant token OR a participant access token.
    // `moderatorToken` is accepted as a legacy alias so an old client bundle
    // still in a tab during a rolling deploy doesn't 400.
    token: z.string().min(1).optional(),
    moderatorToken: z.string().min(1).optional(),
  })
  .refine((d) => !!(d.token ?? d.moderatorToken), {
    message: 'token is required',
  });

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const body = await request.json();
  const parsed = peakSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('Invalid payload', 400, 'INVALID_BODY');
  }

  const { count } = parsed.data;
  const token = (parsed.data.token ?? parsed.data.moderatorToken) as string;

  const event = await prisma.event.findFirst({
    where: {
      ...eventWhereClause(param),
      status: 'LIVE',
    },
    select: { id: true, slug: true, moderatorToken: true, peakParticipants: true },
  });

  if (!event) {
    throw new AppError('Event not found or not live', 404, 'NOT_FOUND');
  }

  // Authorize: ANY valid grant for this event (primary/co-moderator/SPEAKER) OR
  // a registration access token bound to it. verifyGrantToken covers the speaker
  // case that isEventModerator (moderator-only) rejected, so a speaker-only
  // panel still records its peak. Guests (no token) never reach here.
  let authorized = (await verifyGrantToken(event.slug, token)) !== null;
  if (!authorized) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { eventId: true },
    });
    authorized = reg?.eventId === event.id;
  }
  if (!authorized) {
    throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  // The count is client-reported, so clamp to a generous absolute ceiling to
  // bound spoofing — NOT to maxParticipants, which would under-count events
  // where moderators/speakers/guests join beyond the registration cap.
  const capped = Math.min(count, PEAK_HARD_CAP);

  if (capped > event.peakParticipants) {
    await prisma.event.update({
      where: { id: event.id },
      data: { peakParticipants: capped },
    });
  }

  return NextResponse.json({ ok: true });
});
