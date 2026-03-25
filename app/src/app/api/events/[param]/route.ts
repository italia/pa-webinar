import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { updateEventSchema } from '@/lib/validation/schemas';
import { resolveLocale, localiseEvent } from '@/lib/utils/locale';
import {
  extractModeratorToken,
  verifyModeratorToken,
} from '@/lib/auth/moderator';
import { sendDateChangeNotifications } from '@/lib/email/notification';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ param: string }>;
}

// ── GET /api/events/[slug|id] — Event detail ────────────────
// With ?token=moderatorToken: returns full moderator view with registrations.
// Without token: returns public data only.

export async function GET(request: Request, context: RouteContext) {
  const { param } = await context.params;
  const locale = resolveLocale(request);
  const token = extractModeratorToken(request);
  const isUuid = UUID_RE.test(param);

  const event = await prisma.event.findUnique({
    where: isUuid ? { id: param } : { slug: param },
    include: {
      _count: { select: { registrations: true } },
      registrations: token
        ? {
            select: {
              id: true,
              displayName: true,
              joinedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          }
        : false,
    },
  });

  if (!event) {
    return NextResponse.json(
      { error: 'Event not found' },
      { status: 404 },
    );
  }

  const { title, description } = localiseEvent(event, locale);

  // Moderator mode: verify token and return full data
  if (token && event.moderatorToken === token) {
    return NextResponse.json({
      id: event.id,
      slug: event.slug,
      title,
      titleIt: event.titleIt,
      titleEn: event.titleEn,
      description,
      descriptionIt: event.descriptionIt,
      descriptionEn: event.descriptionEn,
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
      moderatorName: event.moderatorName,
      moderatorEmail: event.moderatorEmail,
      jitsiRoomName: event.jitsiRoomName,
      dataRetentionDays: event.dataRetentionDays,
      privacyPolicyUrl: event.privacyPolicyUrl,
      speakersIt: event.speakersIt,
      speakersEn: event.speakersEn,
      organizerName: event.organizerName,
      imageUrl: event.imageUrl,
      waitingRoomAudioUrl: event.waitingRoomAudioUrl,
      createdAt: event.createdAt.toISOString(),
      registrations: event.registrations,
    });
  }

  // Public mode
  return NextResponse.json({
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
    chatEnabled: event.chatEnabled,
    recordingEnabled: event.recordingEnabled,
    status: event.status,
    recordingUrl: event.recordingUrl,
  });
}

// ── PUT /api/events/[id] — Update event (moderator only) ────

export async function PUT(request: Request, context: RouteContext) {
  const { param: eventId } = await context.params;

  if (!UUID_RE.test(eventId)) {
    return NextResponse.json(
      { error: 'Event ID must be a UUID' },
      { status: 400 },
    );
  }

  const token = extractModeratorToken(request);
  if (!token) {
    return NextResponse.json(
      { error: 'Moderator token required' },
      { status: 401 },
    );
  }

  const event = await verifyModeratorToken(eventId, token);
  if (!event) {
    return NextResponse.json(
      { error: 'Invalid moderator token or event not found' },
      { status: 403 },
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

  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const data = parsed.data;

  const dateChanged =
    (data.startsAt !== undefined && data.startsAt !== event.startsAt.toISOString()) ||
    (data.endsAt !== undefined && data.endsAt !== event.endsAt.toISOString());

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      ...(data.titleIt !== undefined && { titleIt: data.titleIt }),
      ...(data.titleEn !== undefined && { titleEn: data.titleEn }),
      ...(data.descriptionIt !== undefined && {
        descriptionIt: data.descriptionIt,
      }),
      ...(data.descriptionEn !== undefined && {
        descriptionEn: data.descriptionEn,
      }),
      ...(data.startsAt !== undefined && {
        startsAt: new Date(data.startsAt),
      }),
      ...(data.endsAt !== undefined && { endsAt: new Date(data.endsAt) }),
      ...(data.timezone !== undefined && { timezone: data.timezone }),
      ...(data.maxParticipants !== undefined && {
        maxParticipants: data.maxParticipants,
      }),
      ...(data.qaEnabled !== undefined && { qaEnabled: data.qaEnabled }),
      ...(data.chatEnabled !== undefined && {
        chatEnabled: data.chatEnabled,
      }),
      ...(data.recordingEnabled !== undefined && {
        recordingEnabled: data.recordingEnabled,
      }),
      ...(data.dataRetentionDays !== undefined && {
        dataRetentionDays: data.dataRetentionDays,
      }),
      ...(data.privacyPolicyUrl !== undefined && {
        privacyPolicyUrl: data.privacyPolicyUrl,
      }),
      ...(data.moderatorName !== undefined && {
        moderatorName: data.moderatorName,
      }),
      ...(data.moderatorEmail !== undefined && {
        moderatorEmail: data.moderatorEmail,
      }),
      ...(data.speakersIt !== undefined && { speakersIt: data.speakersIt }),
      ...(data.speakersEn !== undefined && { speakersEn: data.speakersEn }),
      ...(data.organizerName !== undefined && { organizerName: data.organizerName }),
      ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
      ...(data.waitingRoomAudioUrl !== undefined && { waitingRoomAudioUrl: data.waitingRoomAudioUrl }),
      ...(data.status !== undefined && { status: data.status }),
    },
  });

  if (dateChanged && event.status === 'PUBLISHED') {
    const locale = resolveLocale(request) as 'it' | 'en';
    sendDateChangeNotifications({ eventId, locale });
  }

  return NextResponse.json({ ...updated, dateChanged });
}

// ── DELETE /api/events/[id] — Delete event (moderator only) ──

export async function DELETE(request: Request, context: RouteContext) {
  const { param: eventId } = await context.params;

  if (!UUID_RE.test(eventId)) {
    return NextResponse.json(
      { error: 'Event ID must be a UUID' },
      { status: 400 },
    );
  }

  const token = extractModeratorToken(request);
  if (!token) {
    return NextResponse.json(
      { error: 'Moderator token required' },
      { status: 401 },
    );
  }

  const event = await verifyModeratorToken(eventId, token);
  if (!event) {
    return NextResponse.json(
      { error: 'Invalid moderator token or event not found' },
      { status: 403 },
    );
  }

  await prisma.event.delete({ where: { id: eventId } });

  return NextResponse.json(
    { deleted: true, id: eventId },
    { status: 200 },
  );
}
