import { randomUUID } from 'crypto';

import { NextResponse } from 'next/server';
import type { EventStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { createEventSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { generateUniqueSlug } from '@/lib/utils/slug';
import { resolveLocale, localiseEvent } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

const PUBLIC_STATUSES: EventStatus[] = ['PUBLISHED', 'LIVE', 'ENDED'];

// ── POST /api/events — Create event ──────────────────────────

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit(`create-event:${ip}`, {
    limit: 5,
    windowMs: 60_000,
  });

  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(
            Math.ceil((rl.resetAt - Date.now()) / 1000),
          ),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const data = parsed.data;

  const slug = await generateUniqueSlug(data.titleIt);
  const jitsiRoomName = `evt-${randomUUID()}`;
  const moderatorToken = randomUUID();

  const event = await prisma.event.create({
    data: {
      slug,
      jitsiRoomName,
      moderatorToken,
      titleIt: data.titleIt,
      titleEn: data.titleEn,
      descriptionIt: data.descriptionIt,
      descriptionEn: data.descriptionEn,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      timezone: data.timezone,
      maxParticipants: data.maxParticipants,
      qaEnabled: data.qaEnabled,
      chatEnabled: data.chatEnabled,
      recordingEnabled: data.recordingEnabled,
      dataRetentionDays: data.dataRetentionDays,
      privacyPolicyUrl: data.privacyPolicyUrl,
      moderatorName: data.moderatorName,
      moderatorEmail: data.moderatorEmail,
      speakersIt: data.speakersIt,
      speakersEn: data.speakersEn,
      organizerName: data.organizerName,
      imageUrl: data.imageUrl,
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return NextResponse.json(
    {
      ...event,
      links: {
        publicPage: `${baseUrl}/it/eventi/${event.slug}`,
        moderatorLink: `${baseUrl}/it/admin/eventi/${event.id}?token=${event.moderatorToken}`,
      },
    },
    {
      status: 201,
      headers: { 'X-RateLimit-Remaining': String(rl.remaining) },
    },
  );
}

// ── GET /api/events — List events ────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const moderatorToken = url.searchParams.get('moderatorToken');
  const locale = resolveLocale(request);

  // Moderator mode: return all events owned by this token (including DRAFT)
  if (moderatorToken) {
    const events = await prisma.event.findMany({
      where: { moderatorToken },
      include: { _count: { select: { registrations: true } } },
      orderBy: { startsAt: 'asc' },
    });

    const result = events.map((event) => {
      const { title, description } = localiseEvent(event, locale);
      return {
        id: event.id,
        slug: event.slug,
        title,
        titleIt: event.titleIt,
        titleEn: event.titleEn,
        description,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        timezone: event.timezone,
        maxParticipants: event.maxParticipants,
        registrationCount: event._count.registrations,
        qaEnabled: event.qaEnabled,
        chatEnabled: event.chatEnabled,
        recordingEnabled: event.recordingEnabled,
        status: event.status,
        recordingUrl: event.recordingUrl,
        moderatorToken: event.moderatorToken,
      };
    });

    return NextResponse.json(result);
  }

  // Public mode: only PUBLISHED, LIVE, ENDED
  let whereStatus: EventStatus[];
  if (
    statusFilter &&
    PUBLIC_STATUSES.includes(statusFilter as EventStatus)
  ) {
    whereStatus = [statusFilter as EventStatus];
  } else {
    whereStatus = PUBLIC_STATUSES;
  }

  const events = await prisma.event.findMany({
    where: { status: { in: whereStatus } },
    include: { _count: { select: { registrations: true } } },
    orderBy: { startsAt: 'asc' },
  });

  const result = events.map((event) => {
    const { title, description } = localiseEvent(event, locale);
    return {
      id: event.id,
      slug: event.slug,
      title,
      description,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      timezone: event.timezone,
      maxParticipants: event.maxParticipants,
      registrationCount: event._count.registrations,
      qaEnabled: event.qaEnabled,
      recordingEnabled: event.recordingEnabled,
      status: event.status,
      recordingUrl: event.recordingUrl,
    };
  });

  return NextResponse.json(result);
}
